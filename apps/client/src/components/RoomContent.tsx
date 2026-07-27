import usePartySocket from "partysocket/react";
import { useEffect, useState, useRef, useCallback } from "react";
import type PartySocket from "partysocket";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { BASE_URL, client } from "../utils/honoClient";
import { Ban } from "lucide-react";
import userAuth from "../utils/userSession";
import PollPanel from "./PollPanel";
import PollStage from "./PollStage";
import RoomSettings, { type Participant } from "./RoomSettings";
import QuestionSetManager from "./QuestionSetManager";
import { nanoid } from "nanoid";
import { DEFAULT_POLL_DURATION_MS, EMPTY_POLL_STATE, type PollState } from "../utils/pollTypes";
import {
  markSetLoaded,
  readySetQuestions,
  toAskable,
  type DraftQuestion,
  type QuestionSet,
} from "../utils/questionSets";
import type { AIConfig } from "../utils/aiConfig";

// pdf.js renders PDF pages in-browser; the worker is bundled by Vite.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const PDF_MIME = "application/pdf";

function SlideLoader({ label, progress }: { label: string; progress?: number | null }) {
  const showBar = typeof progress === "number";
  return (
    <div className="flex flex-col items-center gap-3 text-gray-300 w-56 max-w-[70vw]">
      <span className="loading loading-spinner loading-lg text-[#BB8856]" />
      <span className="text-sm sm:text-base">
        {label}{showBar ? ` ${progress}%` : ""}
      </span>
      {showBar && (
        <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full bg-[#BB8856] transition-[width] duration-150"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}

interface RoomContentProps {
  roomId: string;
  presentationId: string;
  presentationMimeType?: string;
  token: string;
  sessionToken: string;
  roomRole: string;
  onRequestLeave: () => void;
  onRoomClosed: (reason?: string) => void;
  onOpenPicker?: () => void;
  pickerReady?: boolean;
}

interface MockSlideProps {
  pageId: string;
  title: string;
}

// Someone knocking on a locked room, waiting for the host to admit them.
export interface JoinRequest {
  connId: string;
  userId: string | null;
  userName: string;
  requestedAt: number;
}

interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  message: string;
  timestamp: number;
  role?: string;
}

const useMockApi = import.meta.env.VITE_USE_MOCK_API === 'true'

function WebSocketConnection({
  roomId,
  sessionToken,
  onConnected,
  onSlideContent,
  onSlideChange,
  onUserCount,
  onChatMessage,
  onHostLeft,
  onHostLeftTick,
  onHostReturned,
  onRoomClosed,
  onMuteStatus,
  onUserJoined,
  onUserLeft,
  onCursorMove,
  onCursorHide,
  onChatWarning,
  onSlideError,
  onPdfContent,
  onPollState,
  onPollTick,
  onParticipants,
  onRoomSettings,
  onRoomLocked,
  onJoinPending,
  onJoinApproved,
  onJoinDenied,
  onJoinRequests,
  onUnauthorizedRole,
  wsRef,
  onConnectionClose
}: {
  roomId: string;
  sessionToken: string;
  onConnected: (connected: boolean) => void;
  onSlideContent: (slides: MockSlideProps[], presentationId?: string) => void;
  onSlideChange: (index: number) => void;
  onUserCount: (count: number) => void;
  onChatMessage: (msg: ChatMessage) => void;
  onHostLeft: (payload: { remainingMs: number; endsAt: number; totalMs?: number }) => void;
  onHostLeftTick: (payload: { remainingMs: number; endsAt: number }) => void;
  onHostReturned: () => void;
  onRoomClosed: (reason?: string) => void;
  onMuteStatus: (payload: { userId: string; isMuted: boolean }) => void;
  onUserJoined: (userName: string) => void;
  onUserLeft: (userName: string) => void;
  onCursorMove?: (pos: { x: number; y: number }) => void;
  onCursorHide?: () => void;
  onChatWarning: (message: string) => void;
  onSlideError?: (message: string) => void;
  onPdfContent?: (fileId: string) => void;
  onPollState?: (state: PollState) => void;
  onPollTick?: (remainingMs: number) => void;
  onParticipants?: (participants: Participant[]) => void;
  onRoomSettings?: (settings: { chatEnabled: boolean; locked: boolean }) => void;
  onRoomLocked?: () => void;
  onJoinPending?: (expiresAt: number) => void;
  onJoinApproved?: () => void;
  onJoinDenied?: (message: string, reason: 'denied' | 'no_answer') => void;
  onJoinRequests?: (requests: JoinRequest[]) => void;
  onUnauthorizedRole?: () => void;
  wsRef: { current: PartySocket | null };
  onConnectionError?: (message: string) => void;
  onConnectionClose?: (closeCode?: number) => void;
}) {
  const partyKitConnect = import.meta.env.VITE_PARTYKIT_SERVER_URL

  const ws = usePartySocket({
    host: partyKitConnect,
    room: roomId,
    query: { token: sessionToken },

    onOpen() {
      onConnected(true)
    },
    onMessage(e) {
      const data = JSON.parse(e.data);
      if (data.type === 'slide_content') {
        onSlideContent(data.slides, data.presentationId);
      } else if (data.type === 'pdf_content') {
        onPdfContent?.(data.fileId);
      } else if (data.type === 'slide_change') {
        onSlideChange(data.slideIndex);
      } else if (data.type === 'user_count') {
        onUserCount(data.count);
      } else if (data.type === 'chat_message') {
        onChatMessage({ ...data, role: data.role ?? 'viewer' });
      } else if (data.type === 'host_left') {
        onHostLeft({
          remainingMs: Number(data.remainingMs ?? 0),
          endsAt: Number(data.endsAt ?? Date.now()),
          totalMs: data.totalMs !== undefined ? Number(data.totalMs) : undefined,
        })
      } else if (data.type === 'host_left_tick') {
        onHostLeftTick({
          remainingMs: Number(data.remainingMs ?? 0),
          endsAt: Number(data.endsAt ?? Date.now())
        })
      } else if (data.type === 'host_returned') {
        onHostReturned()
      } else if (data.type === 'room_closed') {
        onRoomClosed(data.reason)
      } else if (data.type === 'mute_status') {
        onMuteStatus({ userId: data.userId, isMuted: data.isMuted })
      } else if (data.type === 'cursor_move') {
        onCursorMove?.({ x: data.x, y: data.y })
      } else if (data.type === 'cursor_hide') {
        onCursorHide?.()
      } else if (data.type === 'user_joined') {
        onUserJoined(data.userName)
      } else if (data.type === 'user_left') {
        onUserLeft(data.userName)
      } else if (data.type === 'chat_warning') {
        onChatWarning(data.message)
      } else if (data.type === 'poll_state') {
        onPollState?.({
          poll: data.poll ?? null,
          counts: data.counts ?? {},
          countsVisible: !!data.countsVisible,
          totalVotes: Number(data.totalVotes ?? 0),
          eligibleVoters: Number(data.eligibleVoters ?? 0),
          myVote: data.myVote ?? null,
          remainingMs: data.remainingMs === null || data.remainingMs === undefined
            ? null
            : Number(data.remainingMs),
          queueTotal: Number(data.queueTotal ?? 0),
          queueAsked: Number(data.queueAsked ?? 0),
          queuePreview: data.queuePreview ?? [],
        })
      } else if (data.type === 'poll_tick') {
        onPollTick?.(Number(data.remainingMs ?? 0))
      } else if (data.type === 'join_pending') {
        onJoinPending?.(Number(data.expiresAt ?? 0))
      } else if (data.type === 'join_approved') {
        onJoinApproved?.()
      } else if (data.type === 'join_denied') {
        onJoinDenied?.(data.message ?? 'The host didn\'t let you in.', data.reason ?? 'denied')
      } else if (data.type === 'join_requests') {
        onJoinRequests?.(data.requests ?? [])
      } else if (data.type === 'participants') {
        onParticipants?.(data.participants ?? [])
      } else if (data.type === 'room_settings') {
        onRoomSettings?.({ chatEnabled: data.chatEnabled !== false, locked: data.locked === true })
      } else if (data.type === 'error') {
        console.error('Server error:', data.message)
        if (data.errorCode === 'unauthorized_role') {
          onUnauthorizedRole?.()
        } else if (data.errorCode === 'room_locked') {
          onRoomLocked?.()
        } else {
          onSlideError?.(data.message)
        }
      }
    },
    onClose(e) {
      onConnected(false)
      // Pass the close code through — it's the authoritative reason. The
      // server's "room_locked" message and its close race each other, so
      // relying on the message alone loses the reason half the time.
      onConnectionClose?.(e?.code)
    },
    onError(e) {
      console.error('WebSocket error:', e)
      // Don't surface the error immediately — partysocket will auto-retry.
      // The 8-second timeout in RoomContent will show an error if the
      // connection still hasn't succeeded by then.
    }
  })

  useEffect(() => {
    wsRef.current = ws;
  }, [ws, wsRef])

  return null;
}

function RoomContent({
  roomId,
  presentationId,
  presentationMimeType,
  token,
  sessionToken,
  roomRole,
  onRequestLeave,
  onRoomClosed,
  onOpenPicker,
  pickerReady = false
}: RoomContentProps) {

  const { session } = userAuth();
  const currentUserId = session?.user?.id;

  const [socketConnected, setSocketConnected] = useState(false);
  const [slideContent, setSlideContent] = useState<MockSlideProps[]>([]);
  const [activePresentationId, setActivePresentationId] = useState(presentationId);
  const [slideImage, setSlideImage] = useState<string>('')
  const [currentSlide, setCurrentSlide] = useState(0)
  const [slideError, setSlideError] = useState<string | null>(null)
  const [pdfFileId, setPdfFileId] = useState<string | null>(null)
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null)
  const [pdfPageCount, setPdfPageCount] = useState(0)
  const [pdfProgress, setPdfProgress] = useState<number | null>(null)
  const pdfCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const isPdf = presentationMimeType === PDF_MIME
  const totalSlides = pdfDoc ? pdfPageCount : slideContent.length
  const [userCount, setUserCount] = useState(1)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [mutedUsers, setMutedUsers] = useState<Set<string>>(new Set())
  const [isMuted, setIsMuted] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [chatOpen, setChatOpen] = useState(false)
  const [chatCollapsed, setChatCollapsed] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [activeTab, setActiveTab] = useState<'chat' | 'polls' | 'settings'>('chat')
  const [participants, setParticipants] = useState<Participant[]>([])
  const [chatEnabled, setChatEnabled] = useState(true)
  const [roomLocked, setRoomLocked] = useState(false)
  const [pollState, setPollState] = useState<PollState>(EMPTY_POLL_STATE)
  const [pollUnread, setPollUnread] = useState(false)
  const [setManagerOpen, setSetManagerOpen] = useState(false)
  const activeTabRef = useRef<'chat' | 'polls' | 'settings'>('chat')
  const lastPollIdRef = useRef<string | null>(null)
  const [hostLeftRemainingMs, setHostLeftRemainingMs] = useState<number | null>(null)
  const [hostLeftTotalMs, setHostLeftTotalMs] = useState<number | null>(null)
  const [chatWarning, setChatWarning] = useState<string | null>(null)
  const chatWarningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chatOpenRef = useRef<boolean>(false)
  const wsRef = useRef<PartySocket | null>(null);
  const roomRoleRef = useRef(roomRole)
  useEffect(() => { roomRoleRef.current = roomRole }, [roomRole])
  useEffect(() => { socketConnectedRef.current = socketConnected }, [socketConnected])
  const joinBatchRef = useRef<string[]>([])
  const leaveBatchRef = useRef<string[]>([])
  const joinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [roomNotification, setRoomNotification] = useState<string | null>(null)
  const notifDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const slideCacheRef = useRef<Map<string, string>>(new Map());
  const [cachedPageIds, setCachedPageIds] = useState<Set<string>>(new Set());
  const slideImgRef = useRef<HTMLImageElement | null>(null);
  const lastCursorSendRef = useRef<number>(0);
  const [laserCursor, setLaserCursor] = useState<{ x: number; y: number } | null>(null);
  const [laserEnabled, setLaserEnabled] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [socketRetryKey, setSocketRetryKey] = useState(0)
  // Turned away because the host locked the room. Kept separate from a generic
  // disconnect so the close handler can't overwrite the reason, and so we stop
  // reconnecting into a room that will keep rejecting us.
  const [lockedOut, setLockedOut] = useState(false)
  const ROOM_LOCKED_CLOSE_CODE = 4003
  const LOCKED_MESSAGE = 'This room is locked — the host has stopped new people joining.'
  // Waiting on the host to admit us to a locked room, and (for the host) the
  // list of people currently knocking.
  const [awaitingApproval, setAwaitingApproval] = useState(false)
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([])
  const awaitingApprovalRef = useRef(false)
  useEffect(() => { awaitingApprovalRef.current = awaitingApproval }, [awaitingApproval])

  const handleApproveJoin = useCallback((connId: string) => {
    wsRef.current?.send(JSON.stringify({ type: 'approve_join', connId }))
  }, [])

  const handleDenyJoin = useCallback((connId: string) => {
    wsRef.current?.send(JSON.stringify({ type: 'deny_join', connId }))
  }, [])
  const socketConnectedRef = useRef(false)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  useEffect(() => {
    chatOpenRef.current = chatOpen
    if (chatOpen && activeTab === 'chat') setUnreadCount(0)
  }, [chatOpen, activeTab])

  useEffect(() => {
    if (!chatCollapsed && activeTab === 'chat') setUnreadCount(0)
  }, [chatCollapsed, activeTab])

  useEffect(() => {
    activeTabRef.current = activeTab
    if (activeTab === 'chat') setUnreadCount(0)
    if (activeTab === 'polls') setPollUnread(false)
  }, [activeTab])

  const handleSendChat = () => {
    if (!chatInput.trim() || !wsRef.current) return
    wsRef.current.send(JSON.stringify({
      type: 'chat_message',
      message: chatInput.trim()
    }))
    setChatInput('')
  }

  const handleSlideContent = useCallback((slides: MockSlideProps[], pid?: string) => {
    setSlideContent(slides)
    setSlideError(null)
    // Switching from a PDF to a Slides deck: drop the PDF so the image path renders.
    setPdfFileId(null)
    setPdfDoc(null)
    setPdfPageCount(0)
    if (pid) setActivePresentationId(pid)
  }, [])

  const handlePdfContent = useCallback((fileId: string) => {
    // Switching to a PDF: drop any Slides state so the canvas path renders.
    setSlideContent([])
    setSlideImage('')
    setSlideError(null)
    setPdfFileId(fileId)
  }, [])

  const handleChatMessage = useCallback((msg: ChatMessage) => {
    setChatMessages(prev => [...prev, msg])
    if (!chatOpenRef.current || activeTabRef.current !== 'chat') setUnreadCount(prev => prev + 1)
  }, [])

  const handleMuteStatus = useCallback(({ userId, isMuted: muted }: { userId: string; isMuted: boolean }) => {
    setMutedUsers(prev => {
      const next = new Set(prev)
      if (muted) next.add(userId)
      else next.delete(userId)
      return next
    })
    if (userId === currentUserId) setIsMuted(muted)
  }, [currentUserId])

  const handleMuteUser = useCallback((userId: string) => {
    if (!wsRef.current) return
    wsRef.current.send(JSON.stringify({ type: 'mute_user', userId }))
  }, [])

  const showRoomNotification = useCallback((msg: string) => {
    setRoomNotification(msg)
    if (notifDismissRef.current) clearTimeout(notifDismissRef.current)
    notifDismissRef.current = setTimeout(() => setRoomNotification(null), 3500)
  }, [])

  const knownRequestsRef = useRef<Set<string>>(new Set())

  const handleJoinRequests = useCallback((requests: JoinRequest[]) => {
    const fresh = requests.filter((r) => !knownRequestsRef.current.has(r.connId))
    knownRequestsRef.current = new Set(requests.map((r) => r.connId))
    if (fresh.length === 1) {
      showRoomNotification(`${fresh[0].userName} is asking to join`)
    } else if (fresh.length > 1) {
      showRoomNotification(`${fresh.length} people are asking to join`)
    }
    setJoinRequests(requests)
  }, [showRoomNotification])


  const handlePollState = useCallback((next: PollState) => {
    setPollState(next)
    const pollId = next.poll?.id ?? null
    if (pollId && pollId !== lastPollIdRef.current) {
      if (activeTabRef.current !== 'polls') setPollUnread(true)
      showRoomNotification(
        roomRoleRef.current === 'host'
          ? 'Question sent to the room'
          : 'The host asked a question',
      )
    }
    lastPollIdRef.current = pollId
  }, [showRoomNotification])

  const handlePollTick = useCallback((remainingMs: number) => {
    setPollState(prev => (prev.poll ? { ...prev, remainingMs } : prev))
  }, [])

  const handleCreatePoll = useCallback((
    question: string,
    options: string[],
    correctIndex: number | null,
    durationMs: number | null,
  ) => {
    wsRef.current?.send(JSON.stringify({ type: 'create_poll', question, options, correctIndex, durationMs }))
  }, [])

  const handleVote = useCallback((optionId: string) => {
    wsRef.current?.send(JSON.stringify({ type: 'poll_vote', optionId }))
  }, [])

  const handleClosePoll = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: 'close_poll' }))
  }, [])

  const handleClearPoll = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: 'clear_poll' }))
  }, [])

  const handleLoadSet = useCallback((set: QuestionSet) => {
    // Remember it so the room-close prompt can offer to keep or delete it.
    markSetLoaded(set.id)
    // Only send ready questions, compacted so the correct-answer index stays valid.
    wsRef.current?.send(JSON.stringify({
      type: 'load_queue',
      questions: readySetQuestions(set).map(toAskable),
    }))
  }, [])

  const handleAskNext = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: 'ask_next' }))
  }, [])

  const handleClearQueue = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: 'clear_queue' }))
  }, [])

  const canGenerateQuiz = isPdf ? !!pdfDoc : !!activePresentationId && slideContent.length > 0
  const deckLabel = isPdf ? 'PDF' : 'slides'

  const handleGenerateQuiz = useCallback(async (
    config: AIConfig,
    count: number,
  ): Promise<DraftQuestion[]> => {
    let source: { type: 'text'; text: string } | { type: 'slides'; presentationId: string; roomId: string }
    if (isPdf) {
      if (!pdfDoc) throw new Error('The PDF is still loading. Try again in a moment.')
      const pages: string[] = []
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i)
        const content = await page.getTextContent()
        const text = content.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ')
          .trim()
        if (text) pages.push(text)
      }
      source = { type: 'text', text: pages.join('\n\n') }
    } else {
      if (!activePresentationId) throw new Error('No deck is loaded yet.')
      source = { type: 'slides', presentationId: activePresentationId, roomId }
    }

    const res = await client.api["generate-quiz"].$post({
      json: { provider: config.provider, apiKey: config.apiKey, count, source },
    })

    if (!res.ok) {
      const body = await res.json().catch(() => null) as { error?: string } | null
      throw new Error(body?.error ?? "Couldn't generate questions.")
    }

    const data = await res.json() as { questions: { question: string; options: string[]; correctIndex: number }[] }
    return data.questions.map((q) => ({
      id: nanoid(8),
      question: q.question,
      options: q.options,
      correctIndex: q.correctIndex,
      durationMs: DEFAULT_POLL_DURATION_MS,
    }))
  }, [isPdf, pdfDoc, activePresentationId, roomId])

  const handleToggleChat = useCallback((enabled: boolean) => {
    wsRef.current?.send(JSON.stringify({ type: 'set_chat_enabled', enabled }))
  }, [])

  const handleToggleLock = useCallback((locked: boolean) => {
    wsRef.current?.send(JSON.stringify({ type: 'set_locked', locked }))
  }, [])

  const handleUserJoined = useCallback((userName: string) => {
    joinBatchRef.current.push(userName)
    if (joinTimerRef.current) clearTimeout(joinTimerRef.current)
    joinTimerRef.current = setTimeout(() => {
      const names = joinBatchRef.current.splice(0)
      const isHost = roomRoleRef.current === 'host'
      if (isHost) {
        if (names.length === 1) showRoomNotification(`${names[0]} joined`)
        else if (names.length === 2) showRoomNotification(`${names[0]} and ${names[1]} joined`)
        else showRoomNotification(`${names[0]}, ${names[1]} and ${names.length - 2} others joined`)
      } else {
        showRoomNotification(`${names.length} ${names.length === 1 ? 'person' : 'people'} joined`)
      }
    }, 2000)
  }, [showRoomNotification])

  const handleUserLeft = useCallback((userName: string) => {
    leaveBatchRef.current.push(userName)
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current)
    leaveTimerRef.current = setTimeout(() => {
      const names = leaveBatchRef.current.splice(0)
      const isHost = roomRoleRef.current === 'host'
      if (isHost) {
        if (names.length === 1) showRoomNotification(`${names[0]} left`)
        else if (names.length === 2) showRoomNotification(`${names[0]} and ${names[1]} left`)
        else showRoomNotification(`${names[0]}, ${names[1]} and ${names.length - 2} others left`)
      } else {
        showRoomNotification(`${names.length} ${names.length === 1 ? 'person' : 'people'} left`)
      }
    }, 2000)
  }, [showRoomNotification])

  useEffect(() => {
    return () => {
      if (joinTimerRef.current) clearTimeout(joinTimerRef.current)
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current)
      if (notifDismissRef.current) clearTimeout(notifDismissRef.current)
      if (chatWarningTimerRef.current) clearTimeout(chatWarningTimerRef.current)
    }
  }, [])

  const sendCursorPosition = useCallback((clientX: number, clientY: number) => {
    // Slides render into <img>, PDFs into <canvas>; use whichever is mounted.
    const contentEl = slideImgRef.current ?? pdfCanvasRef.current
    if (!wsRef.current || !contentEl) return
    const now = Date.now()
    if (now - lastCursorSendRef.current < 16) return
    lastCursorSendRef.current = now
    const rect = contentEl.getBoundingClientRect()
    const x = (clientX - rect.left) / rect.width
    const y = (clientY - rect.top) / rect.height
    if (x < 0 || x > 1 || y < 0 || y > 1) return
    wsRef.current.send(JSON.stringify({ type: 'cursor_move', x, y }))
    setLaserCursor({ x, y })
  }, [])

  const sendCursorHide = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: 'cursor_hide' }))
    setLaserCursor(null)
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (roomRole !== 'host' || !laserEnabled) return
    sendCursorPosition(e.clientX, e.clientY)
  }, [roomRole, laserEnabled, sendCursorPosition])

  const handleMouseLeave = useCallback(() => {
    if (roomRole !== 'host' || !laserEnabled) return
    sendCursorHide()
  }, [roomRole, laserEnabled, sendCursorHide])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (roomRole !== 'host' || !laserEnabled) return
    const touch = e.touches[0]
    if (!touch) return
    sendCursorPosition(touch.clientX, touch.clientY)
  }, [roomRole, laserEnabled, sendCursorPosition])

  const handleTouchEnd = useCallback(() => {
    if (roomRole !== 'host' || !laserEnabled) return
    sendCursorHide()
  }, [roomRole, laserEnabled, sendCursorHide])

  const toggleLaser = useCallback(() => {
    setLaserEnabled(prev => {
      if (!prev) {
        // Ask the server to re-verify our role in case it wasn't resolved yet
        wsRef.current?.send(JSON.stringify({ type: 'verify_role' }))
      }
      if (prev) sendCursorHide()
      return !prev
    })
  }, [sendCursorHide])

  const handleLeaveRoom = useCallback(() => {
    onRequestLeave()
  }, [onRequestLeave])

  const formatTimer = (remainingMs: number) => {
    const totalSeconds = Math.ceil(Math.max(0, remainingMs) / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  const getTimerProgress = () => {
    if (!hostLeftRemainingMs || !hostLeftTotalMs || hostLeftTotalMs <= 0) return 0
    return Math.max(0, Math.min(1, hostLeftRemainingMs / hostLeftTotalMs))
  }

  // Save slide data to DB once and pre-fetch all slide images when slideContent arrives
  useEffect(() => {
    if (!slideContent.length || !activePresentationId || useMockApi) return

    const cache = slideCacheRef.current

    // Save to room_slide table (upsert — only meaningful data, runs once per load)
    client.api["room-slide"].$post({
      json: { roomId, presentationId: activePresentationId, slides: slideContent },
    }).catch(err => console.error('Failed to save slides to DB:', err))

    // Pre-fetch all slide images and store as blob URLs
    slideContent.forEach(async (slide) => {
      if (cache.has(slide.pageId)) return
      try {
        const res = await client.api.slideimage[":presentationId"][":pageObjectId"].$get({
          param: { presentationId: activePresentationId, pageObjectId: slide.pageId },
          query: { roomId },
        })
        if (res.ok) {
          const blob = await res.blob()
          cache.set(slide.pageId, URL.createObjectURL(blob))
          setCachedPageIds(prev => new Set([...prev, slide.pageId]))
        }
      } catch (err) {
        console.error(`Failed to pre-fetch slide ${slide.pageId}:`, err)
      }
    })
  }, [slideContent, activePresentationId])

  // Clean up blob URLs on unmount
  useEffect(() => {
    return () => {
      slideCacheRef.current.forEach(url => URL.revokeObjectURL(url))
    }
  }, [])

  // Send load_slide message when presentationId becomes available
  useEffect(() => {
    if (!(socketConnected && presentationId && wsRef.current && !useMockApi)) return
    setSlideError(null)
    if (isPdf) {
      // The PDF proxy resolves the host's Google token server-side, so no token here.
      wsRef.current.send(JSON.stringify({
        type: 'load_pdf',
        fileId: presentationId,
      }))
    } else if (token) {
      wsRef.current.send(JSON.stringify({
        type: 'load_slide',
        presentationId: presentationId,
        token: token
      }))
    }
  }, [socketConnected, presentationId, token, isPdf])

  // Load the PDF (every participant) once a pdf_content broadcast provides the fileId.
  // The server proxy streams the host's Drive PDF; pdf.js renders it locally.
  useEffect(() => {
    if (!pdfFileId || useMockApi) return
    let cancelled = false
    setSlideError(null)
    setPdfDoc(null)
    setPdfPageCount(0)
    setPdfProgress(0)
    const url = `${BASE_URL}/api/pdf/${pdfFileId}?roomId=${roomId}`
    const loadingTask = pdfjsLib.getDocument({
      url,
      withCredentials: true,
      // One credentialed request — avoids Range preflight against the API origin.
      disableRange: true,
      disableStream: true,
    })
    // Report download progress (null if the server didn't send Content-Length).
    loadingTask.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
      if (cancelled) return
      setPdfProgress(total ? Math.min(100, Math.round((loaded / total) * 100)) : null)
    }
    loadingTask.promise
      .then((doc) => {
        if (cancelled) return
        setPdfProgress(null)
        setPdfDoc(doc)
        setPdfPageCount(doc.numPages)
      })
      .catch((err) => {
        console.error('Failed to load PDF:', err)
        if (!cancelled) setSlideError('Failed to load this PDF. The host may need to reconnect Google.')
      })
    // Destroying the loading task tears down the document and its worker.
    return () => {
      cancelled = true
      loadingTask.destroy().catch(() => {})
    }
  }, [pdfFileId, roomId])

  // Render the current PDF page to the canvas.
  useEffect(() => {
    if (!pdfDoc) return
    let cancelled = false
    const holder: { task?: { cancel: () => void } } = {}
    pdfDoc.getPage(currentSlide + 1).then((page) => {
      if (cancelled) return
      const canvas = pdfCanvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const viewport = page.getViewport({ scale: 1.5 })
      canvas.width = viewport.width
      canvas.height = viewport.height
      const task = page.render({ canvas, canvasContext: ctx, viewport })
      holder.task = task
      task.promise.catch(() => { /* cancelled renders reject; ignore */ })
    }).catch((err) => console.error('Failed to render PDF page:', err))
    return () => {
      cancelled = true
      holder.task?.cancel()
    }
  }, [pdfDoc, currentSlide])

  // Host broadcasts page changes for PDFs (Slides do this via the image effect below).
  useEffect(() => {
    if (!pdfDoc) return
    if (roomRole === 'host' && wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: 'slide_change', slideIndex: currentSlide }))
    }
  }, [currentSlide, pdfDoc, roomRole])

  useEffect(() => {
    if (useMockApi) {
      setSocketConnected(true)
      setUserCount(3)
      setActivePresentationId('mock-presentation-id')
      setTimeout(() => {
        const mockSlides: MockSlideProps[] = [
          { pageId: 'mock-page-1', title: 'Slide 1' },
          { pageId: 'mock-page-2', title: 'Slide 2' },
          { pageId: 'mock-page-3', title: 'Slide 3' }
        ]
        setSlideContent(mockSlides)

        setChatMessages([
          { id: '1', userId: 'user1', userName: 'Alice', message: 'Hello everyone!', timestamp: Date.now() - 60000 },
          { id: '2', userId: 'user2', userName: 'Bob', message: 'Hi Alice!', timestamp: Date.now() - 30000 },
        ])
      }, 500)
    }
  }, [])

  useEffect(() => {
    if (!roomId || !sessionToken || useMockApi) return
    const controller = new AbortController()
    fetch(`${BASE_URL}/api/party/session-user?roomId=${encodeURIComponent(roomId)}`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
      signal: controller.signal
    })
      .then(async (res) => ({ ok: res.ok, data: await res.json().catch(() => null) }))
      .then(({ ok, data }) => {
        if (!ok) {
          console.warn('Session role check failed:', data)
          return
        }
        if (data?.role && data.role !== roomRole) {
          console.warn('Role mismatch between client and backend:', { client: roomRole, backend: data.role })
        }
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') {
          console.warn('Session role check error:', err)
        }
      })
    return () => controller.abort()
  }, [roomId, sessionToken, roomRole])


  useEffect(() => {
    if (!slideContent.length || !activePresentationId) return

    const pageId = slideContent[currentSlide]?.pageId
    if (!pageId) return

    const cached = slideCacheRef.current.get(pageId)
    if (cached) {
      setSlideImage(cached)
    } else {
      setSlideImage(
        `/api/slideimage/${activePresentationId}/${pageId}?roomId=${roomId}`
      )
    }

    if (roomRole === 'host' && wsRef.current) {
      wsRef.current.send(JSON.stringify({
        type: 'slide_change',
        slideIndex: currentSlide,
      }))
    }
  }, [currentSlide, slideContent, activePresentationId, roomRole, cachedPageIds])


  useEffect(() => {
    if (useMockApi || !roomId || !sessionToken) return
    setConnecting(true)
    setConnectionError(null)
    const timer = setTimeout(() => {
      if (!socketConnectedRef.current) {
        setConnectionError('Still connecting. Please check the room server and try again.')
        setConnecting(false)
      }
    }, 8000)
    return () => clearTimeout(timer)
  }, [roomId, sessionToken, socketRetryKey])

  return (
    <div className="flex flex-col lg:flex-row h-[100dvh] lg:h-[calc(100vh-80px)] w-full gap-2 lg:gap-4 p-0 lg:p-4">

      {roomNotification && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] bg-white dark:bg-gray-900 text-gray-800 dark:text-white text-sm px-4 py-2.5 rounded-xl pointer-events-none shadow-lg border border-gray-100 dark:border-gray-800 max-w-[280px] text-center whitespace-nowrap">
          {roomNotification}
        </div>
      )}

      {setManagerOpen && (
        <div className="fixed inset-0 z-[100] flex items-start sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-2xl bg-base-100 sm:rounded-2xl shadow-2xl p-4 sm:p-6 min-h-full sm:min-h-0 sm:max-h-[88vh] sm:overflow-y-auto">
            <QuestionSetManager
              onClose={() => setSetManagerOpen(false)}
              onGenerate={roomRole === 'host' ? handleGenerateQuiz : undefined}
              canGenerate={canGenerateQuiz}
              deckLabel={deckLabel}
              onLoadSet={(set) => {
                handleLoadSet(set)
                setSetManagerOpen(false)
                showRoomNotification(`Loaded “${set.title || 'set'}”`)
              }}
            />
          </div>
        </div>
      )}
      {!useMockApi && roomId && sessionToken && !lockedOut && (
        <WebSocketConnection
          key={socketRetryKey}
          roomId={roomId}
          sessionToken={sessionToken}
          onConnected={(connected) => {
            setSocketConnected(connected)
            if (connected) {
              setConnectionError(null)
              setConnecting(false)
              setHostLeftRemainingMs(null)
              setHostLeftTotalMs(null)
            } else if (!connectionError) {
              setConnecting(false)
            }
          }}
          onSlideContent={handleSlideContent}
          onSlideError={setSlideError}
          onPdfContent={handlePdfContent}
          onPollState={handlePollState}
          onPollTick={handlePollTick}
          onParticipants={setParticipants}
          onRoomSettings={({ chatEnabled: ce, locked }) => {
            setChatEnabled(ce)
            setRoomLocked(locked)
          }}
          onRoomLocked={() => {
            setLockedOut(true)
            setConnectionError(LOCKED_MESSAGE)
            setConnecting(false)
          }}
          onJoinPending={() => {
            setAwaitingApproval(true)
            setConnectionError(null)
            setConnecting(false)
          }}
          onJoinApproved={() => {
            setAwaitingApproval(false)
            setConnectionError(null)
          }}
          onJoinDenied={(_message, reason) => {
            setAwaitingApproval(false)
            setLockedOut(true)
            setConnecting(false)
            onRoomClosed(reason === 'no_answer' ? 'join_no_answer' : 'join_denied')
          }}
          onJoinRequests={handleJoinRequests}
          onSlideChange={setCurrentSlide}
          onUserCount={setUserCount}
          onChatMessage={handleChatMessage}
          onHostLeft={({ remainingMs, totalMs }) => {
            if (roomRole === 'viewer') {
              setHostLeftRemainingMs(remainingMs)
              setHostLeftTotalMs(totalMs ?? remainingMs)
            }
          }}
          onHostLeftTick={({ remainingMs }) => {
            if (roomRole === 'viewer') {
              setHostLeftRemainingMs(remainingMs)
              setHostLeftTotalMs(prev => prev ?? remainingMs)
            }
          }}
          onHostReturned={() => {
            setHostLeftRemainingMs(null)
            setHostLeftTotalMs(null)
          }}
          onRoomClosed={(reason) => onRoomClosed(reason)}
          onMuteStatus={handleMuteStatus}
          onUserJoined={handleUserJoined}
          onUserLeft={handleUserLeft}
          onCursorMove={setLaserCursor}
          onCursorHide={() => setLaserCursor(null)}
          onChatWarning={(msg) => {
            setChatWarning(msg)
            if (chatWarningTimerRef.current) clearTimeout(chatWarningTimerRef.current)
            chatWarningTimerRef.current = setTimeout(() => setChatWarning(null), 4000)
          }}
          onUnauthorizedRole={() => {
            // Our role wasn't resolved yet on the server — request immediate re-verify
            wsRef.current?.send(JSON.stringify({ type: 'verify_role' }))
          }}
          wsRef={wsRef}
          onConnectionError={(message) => {
            setConnectionError(message)
            setConnecting(false)
          }}
          onConnectionClose={(closeCode) => {
            if (closeCode === ROOM_LOCKED_CLOSE_CODE || lockedOut) {
              setLockedOut(true)
              setConnectionError(LOCKED_MESSAGE)
            } else if (socketConnected) {
              setConnectionError('Disconnected from the room.')
            }
            setConnecting(false)
          }}
        />
      )}

      {socketConnected && !awaitingApproval ? (
        <>
          <div className="w-full flex-1 lg:aspect-auto flex flex-col bg-gray-900 overflow-hidden">
            <div className="flex-1 relative flex items-center justify-center overflow-hidden">
              {pollState.poll && (
                <PollStage
                  state={pollState}
                  isHost={roomRole === 'host'}
                  isMuted={isMuted}
                  onVote={handleVote}
                  onClosePoll={handleClosePoll}
                  onClearPoll={handleClearPoll}
                  onAskNext={handleAskNext}
                />
              )}

              {roomRole === 'viewer' && hostLeftRemainingMs !== null && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                  <div className="flex flex-col items-center gap-3 select-none">
                    <p className="text-amber-300 font-semibold text-xs tracking-[0.2em] uppercase">
                      Host Disconnected
                    </p>
                    <div className="relative">
                      <svg
                        width="160" height="160" viewBox="0 0 160 160"
                        className="-rotate-90"
                      >
                        {/* Outer dark circle */}
                        <circle cx="80" cy="80" r="76" fill="#1a1f2e" />
                        {/* Track ring */}
                        <circle
                          cx="80" cy="80" r="66"
                          fill="none"
                          stroke="rgba(255,255,255,0.08)"
                          strokeWidth="8"
                        />
                        {/* Progress ring */}
                        <circle
                          cx="80" cy="80" r="66"
                          fill="none"
                          stroke="#f87171"
                          strokeWidth="8"
                          strokeLinecap="round"
                          strokeDasharray={`${2 * Math.PI * 66}`}
                          strokeDashoffset={`${2 * Math.PI * 66 * (1 - getTimerProgress())}`}
                          style={{ transition: 'stroke-dashoffset 0.9s linear' }}
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
                        <span className="text-white text-3xl font-bold tabular-nums tracking-widest leading-none">
                          {formatTimer(hostLeftRemainingMs)}
                        </span>
                      </div>
                    </div>
                    <p className="text-white/60 text-xs tracking-wide">
                      Waiting for host to return…
                    </p>
                  </div>
                </div>
              )}

              <div className="absolute top-3 left-3 z-10 rounded-md bg-black/65 px-2.5 py-1 text-xs sm:text-sm text-white">
                Room ID: <span className="font-semibold tracking-wide">{roomId}</span>
              </div>
              <div className="absolute top-3 right-3 z-30 hidden lg:block">
                <button
                  className="btn btn-sm btn-error text-white"
                  onClick={handleLeaveRoom}
                >
                  Leave Room
                </button>
              </div>
              {pdfDoc ? (
                <div
                  className="relative max-w-full max-h-full"
                  style={{ touchAction: roomRole === 'host' && laserEnabled ? 'none' : undefined }}
                  onMouseMove={handleMouseMove}
                  onMouseLeave={handleMouseLeave}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                >
                  <canvas
                    ref={pdfCanvasRef}
                    className="max-w-full max-h-full object-contain block"
                  />
                </div>
              ) : slideError ? (
                <div className="max-w-sm text-center px-4">
                  <div className="text-red-400 text-sm sm:text-base font-medium">{slideError}</div>
                  {!isPdf && (
                    <div className="text-gray-400 text-xs sm:text-sm mt-2">
                      Make sure you picked a Google Slides presentation (not an uploaded PDF or PowerPoint) and that your Google connection is still valid.
                    </div>
                  )}
                </div>
              ) : isPdf ? (
                <SlideLoader label="Loading PDF…" progress={pdfProgress} />
              ) : slideImage ? (
                <div
                  className="relative max-w-full max-h-full"
                  style={{ touchAction: roomRole === 'host' && laserEnabled ? 'none' : undefined }}
                  onMouseMove={handleMouseMove}
                  onMouseLeave={handleMouseLeave}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                >
                  <img
                    ref={slideImgRef}
                    src={slideImage}
                    alt={`Slide ${currentSlide + 1}`}
                    className="max-w-full max-h-full object-contain block"
                  />
                </div>
              ) : (
                <SlideLoader label="Loading slide…" />
              )}

              {/* Laser dot positioned in viewport pixels from the media's real rect —
                  robust to any wrapper sizing, so it tracks the pointer exactly. */}
              {laserCursor && (slideImgRef.current || pdfCanvasRef.current) && (() => {
                const el = (slideImgRef.current ?? pdfCanvasRef.current)!
                const r = el.getBoundingClientRect()
                return (
                  <div
                    className="fixed pointer-events-none z-30"
                    style={{
                      left: r.left + laserCursor.x * r.width,
                      top: r.top + laserCursor.y * r.height,
                      transform: 'translate(-50%, -50%)',
                    }}
                  >
                    <div className="w-4 h-4 rounded-full bg-red-500 shadow-[0_0_10px_4px_rgba(239,68,68,0.7)]" />
                  </div>
                )
              })()}

              {roomRole === 'host' && (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10">
                  <button
                    onClick={toggleLaser}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all shadow-md ${
                      laserEnabled
                        ? 'bg-red-500 text-white shadow-red-500/40'
                        : 'bg-black/60 text-white/80 hover:bg-black/75'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${laserEnabled ? 'bg-white animate-pulse' : 'bg-white/50'}`} />
                    {laserEnabled ? 'Laser On' : 'Laser Off'}
                  </button>
                </div>
              )}

              <div className={`absolute left-2 right-2 sm:left-4 sm:right-4 top-1/2 flex -translate-y-1/2 justify-between pointer-events-none ${roomRole === 'viewer' ? 'hidden' : ''}`}>
                <button
                  className="btn btn-circle btn-sm sm:btn-md bg-white/80 hover:bg-white pointer-events-auto dark:bg-gray-800 dark:text-gray-100"
                  onClick={() => setCurrentSlide(prev => Math.max(0, prev - 1))}
                  disabled={currentSlide === 0}
                >
                  ❮
                </button>
                <button
                  className="btn btn-circle btn-sm sm:btn-md bg-white/80 hover:bg-white pointer-events-auto dark:bg-gray-800 dark:text-gray-100"
                  onClick={() => setCurrentSlide(prev => Math.min(totalSlides - 1, prev + 1))}
                  disabled={currentSlide >= totalSlides - 1}
                >
                  ❯
                </button>
              </div>
            </div>

            <div className="bg-gray-800 text-white text-center py-1.5 sm:py-2 text-xs sm:text-sm">
              Slide {currentSlide + 1} of {totalSlides}
            </div>
          </div>

          {/* Mobile leave room button — shown above chat toggle */}
          <button
            className="lg:hidden fixed bottom-20 right-5 z-40 btn btn-error btn-circle shadow-xl"
            onClick={handleLeaveRoom}
            aria-label="Leave room"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>

          {/* Mobile chat toggle button */}
          <button
            className="lg:hidden fixed bottom-5 right-5 z-40 btn btn-primary btn-circle shadow-xl"
            onClick={() => setChatOpen(true)}
            aria-label="Open chat"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M21 16c0 1.1-.9 2-2 2H7l-4 4V6a2 2 0 012-2h14a2 2 0 012 2v10z" />
            </svg>
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {/* Backdrop */}
          {chatOpen && (
            <div
              className="lg:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
              onClick={() => setChatOpen(false)}
            />
          )}

          {/* Desktop expand button (shown when chat is collapsed) */}
          {chatCollapsed && (
            <div className="hidden lg:flex flex-col items-center gap-1 self-start mt-2 relative">
              <button
                className="p-2 bg-white border border-gray-200 rounded-lg shadow-sm hover:bg-gray-50 transition-colors text-gray-600"
                onClick={() => setChatCollapsed(false)}
                aria-label="Open chat"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              {unreadCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </div>
          )}

          {/* Chat panel — bottom sheet on mobile, sidebar on desktop */}
          <div className={`
            flex flex-col bg-white
            fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl h-dvh shadow-2xl
            transition-transform duration-300 ease-in-out
            lg:static lg:w-80 lg:h-auto lg:max-h-none lg:rounded-lg lg:shadow-sm lg:z-auto lg:translate-y-0
            ${chatOpen ? 'translate-y-0' : 'translate-y-full'}
            ${chatCollapsed ? 'lg:hidden' : ''}
          `}>
            {/* Drag handle (mobile only) */}
            <div className="lg:hidden flex justify-center pt-2 pb-1 shrink-0">
              <div className="w-10 h-1 bg-gray-300 rounded-full" />
            </div>

            <div className="flex items-center justify-between px-3 sm:px-4 py-2 sm:py-3 border-b border-gray-200 bg-gray-50 rounded-t-2xl lg:rounded-t-lg shrink-0">
              <div className="flex items-center gap-1.5 text-xs sm:text-sm text-gray-600">
                <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                <span>{userCount} {userCount === 1 ? 'user' : 'users'} online</span>
              </div>
              <div className="flex items-center gap-3">
                {/* Desktop collapse button */}
                <button
                  className="hidden lg:flex p-1.5 rounded hover:bg-gray-200 transition-colors text-gray-500 hover:text-gray-700"
                  onClick={() => setChatCollapsed(true)}
                  aria-label="Hide chat"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
                {/* Mobile close button */}
                <button
                  className="lg:hidden btn btn-ghost btn-xs btn-circle text-gray-500"
                  onClick={() => setChatOpen(false)}
                  aria-label="Close chat"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            {/* Chat / Polls tabs */}
            <div className="flex border-b border-gray-200 shrink-0">
              {([
                { key: 'chat', label: 'Chat' },
                { key: 'polls', label: 'Question' },
                ...(roomRole === 'host' ? [{ key: 'settings', label: 'Settings' } as const] : []),
              ] as const).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 cursor-pointer transition-colors ${
                    activeTab === tab.key
                      ? 'border-[#BB8856] text-gray-900'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {tab.label}
                  {tab.key === 'chat' && activeTab !== 'chat' && unreadCount > 0 && (
                    <span className="bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                  {tab.key === 'polls' && pollUnread && (
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                  )}
                  {tab.key === 'settings' && joinRequests.length > 0 && (
                    <span className="bg-amber-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                      {joinRequests.length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {activeTab === 'settings' && roomRole === 'host' ? (
              <RoomSettings
                roomId={roomId}
                participants={participants}
                chatEnabled={chatEnabled}
                locked={roomLocked}
                currentUserId={currentUserId}
                isHost={roomRole === 'host'}
                joinRequests={joinRequests}
                onToggleChat={handleToggleChat}
                onToggleLock={handleToggleLock}
                onMuteUser={handleMuteUser}
                onApproveJoin={handleApproveJoin}
                onDenyJoin={handleDenyJoin}
              />
            ) : activeTab === 'polls' ? (
              <PollPanel
                state={pollState}
                isHost={roomRole === 'host'}
                onCreate={handleCreatePoll}
                onManageSets={() => setSetManagerOpen(true)}
                onAskNext={handleAskNext}
                onClearQueue={handleClearQueue}
              />
            ) : (
            <>
            {roomRole === 'host' && (
            <div className="px-3 sm:px-4 py-2 border-b border-gray-100 shrink-0 ">
              <button
                className="btn btn-sm btn-outline w-full dark:bg-gray-800 dark:text-gray-100"
                onClick={onOpenPicker}
                disabled={!onOpenPicker || !pickerReady}
              >
                {pickerReady ? "Choose from Drive" : "Drive Picker Loading..."}
              </button>
            </div>
            )}
            <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 min-h-0">
              {chatMessages.length === 0 ? (
                <p className="text-gray-400 text-center text-sm">No messages yet</p>
              ) : (
                chatMessages.map((msg) => (
                  <div key={msg.id} className="flex flex-col">
                    <div className="group flex items-center gap-2 cursor-pointer">
                      <span className="font-medium text-sm text-gray-800">{msg.userName}</span>
                      <span className="text-xs text-gray-400">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {roomRole === 'host' && msg.role !== 'host' && !!currentUserId && msg.userId !== currentUserId && (
                        <button
                          className="p-1.5 -m-1.5 tooltip tooltip-bottom"
                          data-tip={mutedUsers.has(msg.userId) ? 'unmute user' : 'mute user'}
                          onClick={() => handleMuteUser(msg.userId)}
                        >
                          <Ban className={`size-4 ${mutedUsers.has(msg.userId) ? 'text-red-600' : 'text-gray-400'}`} />
                        </button>
                      )}
                    </div>
                    <p className="text-sm text-gray-600">{msg.message}</p>
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="p-2 sm:p-3 border-t border-gray-200 shrink-0">
              {chatWarning && (
                <div className="flex items-center gap-2 px-3 py-2 mb-2 rounded-lg bg-amber-50 border border-amber-200">
                  <svg xmlns="http://www.w3.org/2000/svg" className="size-4 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  </svg>
                  <p className="text-xs text-amber-700 font-medium">{chatWarning}</p>
                </div>
              )}
              {!chatEnabled && roomRole !== 'host' ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-200">
                  <Ban className="size-4 text-gray-400 shrink-0" />
                  <p className="text-xs text-gray-500 font-medium">The host has turned off chat.</p>
                </div>
              ) : isMuted ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200">
                  <Ban className="size-4 text-red-500 shrink-0" />
                  <p className="text-xs text-red-600 font-medium">You have been muted by the host.</p>
                </div>
              ) : (
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
                    placeholder="Type a message..."
                    className="flex-1 min-w-0 input input-bordered input-sm bg-white text-gray-900 placeholder-gray-400"
                  />
                  <button
                    onClick={handleSendChat}
                    disabled={!chatInput.trim()}
                    className="btn btn-sm shrink-0 bg-[#BB8856] hover:bg-[#A87744] text-white border-0 disabled:bg-[#DCC3A9] disabled:text-white"
                  >
                    Send
                  </button>
                </div>
              )}
            </div>
            </>
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            {awaitingApproval ? (
              <div className="max-w-xs mx-auto px-4">
                <span className="loading loading-spinner loading-lg text-[#BB8856]" />
                <p className="mt-3 font-medium text-base-content">Asking the host to let you in…</p>
                <p className="mt-1 text-sm text-base-content/60">
                  This room is locked. The host has been sent your request.
                </p>
                <button
                  className="btn btn-sm btn-outline mt-4"
                  onClick={handleLeaveRoom}
                >
                  Cancel
                </button>
              </div>
            ) : !sessionToken ? (
              <p className="mt-2 text-base-content/70">Waiting for session...</p>
            ) : connectionError ? (
              <>
                <p className={`text-sm sm:text-base ${lockedOut ? 'text-base-content/80' : 'text-error'}`}>
                  {connectionError}
                </p>
                {lockedOut && (
                  <p className="mt-1 text-xs text-base-content/60">
                    Ask the host to unlock it, then try again.
                  </p>
                )}
                <button
                  className="btn btn-sm btn-outline mt-3"
                  onClick={() => {
                    setLockedOut(false)
                    setConnectionError(null)
                    setSocketRetryKey(prev => prev + 1)
                  }}
                >
                  Try again
                </button>
              </>
            ) : (
              <>
                <span className="loading loading-spinner loading-lg"></span>
                <p className="mt-2 text-base-content/70">
                  {connecting ? 'Connecting to room...' : 'Preparing room...'}
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default RoomContent;
