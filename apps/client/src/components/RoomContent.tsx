import usePartySocket from "partysocket/react";
import { useEffect, useState, useRef, useCallback } from "react";
import type PartySocket from "partysocket";
import { client } from "../utils/honoClient";
import { Ban } from "lucide-react";
import userAuth from "../utils/userSession";

interface RoomContentProps {
  roomId: string;
  presentationId: string;
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
  presentationId,
  token,
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
  wsRef
}: {
  roomId: string;
  presentationId: string;
  token: string;
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
  wsRef: { current: PartySocket | null };
}) {
  const partyKitConnect = import.meta.env.VITE_PARTYKIT_SERVER_URL

  const ws = usePartySocket({
    host: partyKitConnect,
    room: roomId,
    query: { token: sessionToken },

    onOpen() {
      console.log('WebSocket connected. PresentationId:', presentationId)
      onConnected(true)
      if (presentationId) {
        console.log('Sending load_slide on connection')
        ws.send(JSON.stringify({
          type: 'load_slide',
          presentationId: presentationId,
          token: token
        }))
      }
    },
    onMessage(e) {
      const data = JSON.parse(e.data);
      console.log('WebSocket message received:', data.type, data)
      if (data.type === 'slide_content') {
        console.log('Received slide_content with', data.slides?.length, 'slides')
        onSlideContent(data.slides, data.presentationId);
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
      } else if (data.type === 'user_joined') {
        onUserJoined(data.userName)
      } else if (data.type === 'user_left') {
        onUserLeft(data.userName)
      } else if (data.type === 'error') {
        console.error('Server error:', data.message)
      }
    },
    onClose() {
      onConnected(false)
    },
    onError(e) {
      console.error('WebSocket error:', e)
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
  const [userCount, setUserCount] = useState(1)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [mutedUsers, setMutedUsers] = useState<Set<string>>(new Set())
  const [isMuted, setIsMuted] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [chatOpen, setChatOpen] = useState(false)
  const [chatCollapsed, setChatCollapsed] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [hostLeftRemainingMs, setHostLeftRemainingMs] = useState<number | null>(null)
  const [hostLeftTotalMs, setHostLeftTotalMs] = useState<number | null>(null)
  const chatOpenRef = useRef<boolean>(false)
  const wsRef = useRef<PartySocket | null>(null);
  const roomRoleRef = useRef(roomRole)
  useEffect(() => { roomRoleRef.current = roomRole }, [roomRole])
  const joinBatchRef = useRef<string[]>([])
  const leaveBatchRef = useRef<string[]>([])
  const joinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [roomNotification, setRoomNotification] = useState<string | null>(null)
  const notifDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const slideCacheRef = useRef<Map<string, string>>(new Map());
  const [cachedPageIds, setCachedPageIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  useEffect(() => {
    chatOpenRef.current = chatOpen
    if (chatOpen) setUnreadCount(0)
  }, [chatOpen])

  useEffect(() => {
    if (!chatCollapsed) setUnreadCount(0)
  }, [chatCollapsed])

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
    if (pid) setActivePresentationId(pid)
  }, [])

  const handleChatMessage = useCallback((msg: ChatMessage) => {
    console.log('msg', msg)
    setChatMessages(prev => [...prev, msg])
    if (!chatOpenRef.current) setUnreadCount(prev => prev + 1)
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
    }
  }, [])

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
    if (socketConnected && presentationId && token && wsRef.current && !useMockApi) {
      console.log('Sending load_slide message with presentationId:', presentationId)
      wsRef.current.send(JSON.stringify({
        type: 'load_slide',
        presentationId: presentationId,
        token: token
      }))
    }
  }, [socketConnected, presentationId, token])

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

  console.log('socketConnected', socketConnected)

  return (
    <div className="flex flex-col lg:flex-row h-[100dvh] lg:h-[calc(100vh-80px)] w-full gap-2 lg:gap-4 p-0 lg:p-4">

      {roomNotification && (
        <div className="fixed bottom-6 left-6 z-[9999] bg-white dark:bg-black text-gray-800 dark:text-white text-sm px-4 py-2.5 rounded-xl pointer-events-none shadow-lg border border-gray-100 dark:border-gray-800">
          {roomNotification}
        </div>
      )}

      {!useMockApi && roomId && sessionToken && (
        <WebSocketConnection
          roomId={roomId}
          presentationId={presentationId}
          token={token}
          sessionToken={sessionToken}
          onConnected={setSocketConnected}
          onSlideContent={handleSlideContent}
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
          wsRef={wsRef}
        />
      )}

      {socketConnected ? (
        <>
          <div className="w-full flex-1 lg:aspect-auto flex flex-col bg-gray-900 overflow-hidden">
            <div className="flex-1 relative flex items-center justify-center overflow-hidden">
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
              <div className="absolute top-3 right-3 z-10 hidden lg:block">
                <button
                  className="btn btn-sm btn-error text-white"
                  onClick={handleLeaveRoom}
                >
                  Leave Room
                </button>
              </div>
              {slideImage ? (
                <img
                  src={slideImage}
                  alt={`Slide ${currentSlide + 1}`}
                  className="max-w-full max-h-full object-contain"
                />
              ) : (
                <div className="text-gray-400 text-sm sm:text-base">Loading slide...</div>
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
                  onClick={() => setCurrentSlide(prev => Math.min(slideContent.length - 1, prev + 1))}
                  disabled={currentSlide >= slideContent.length - 1}
                >
                  ❯
                </button>
              </div>
            </div>
         
            <div className="bg-gray-800 text-white text-center py-1.5 sm:py-2 text-xs sm:text-sm">
              Slide {currentSlide + 1} of {slideContent.length}
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
            lg:static lg:w-80 lg:h-auto lg:max-h-none lg:rounded-lg lg:border lg:border-gray-200 lg:shadow-sm lg:z-auto lg:translate-y-0
            ${chatOpen ? 'translate-y-0' : 'translate-y-full'}
            ${chatCollapsed ? 'lg:hidden' : ''}
          `}>
            {/* Drag handle (mobile only) */}
            <div className="lg:hidden flex justify-center pt-2 pb-1 shrink-0">
              <div className="w-10 h-1 bg-gray-300 rounded-full" />
            </div>

            <div className="flex items-center justify-between px-3 sm:px-4 py-2 sm:py-3 border-b border-gray-200 bg-gray-50 rounded-t-2xl lg:rounded-t-lg shrink-0">
              <h3 className="font-semibold text-gray-800 text-sm sm:text-base">Chat</h3>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 text-xs sm:text-sm text-gray-600">
                  <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                  <span>{userCount} {userCount === 1 ? 'user' : 'users'} online</span>
                </div>
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
                      {roomRole === 'host' && msg.role !== 'host' && msg.userId !== currentUserId && (
                        <button
                          className=" tooltip tooltip-bottom"
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
              {isMuted ? (
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
                    className="btn btn-sm shrink-0 bg-blue-600 hover:bg-blue-700 text-white border-0 disabled:bg-blue-300 disabled:text-white"
                  >
                    Send
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <span className="loading loading-spinner loading-lg"></span>
            <p className="mt-2 text-gray-600">Connecting to room...</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default RoomContent;
