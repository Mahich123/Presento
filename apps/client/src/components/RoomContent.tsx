import usePartySocket from "partysocket/react";
import { useEffect, useState, useRef, useCallback } from "react";
import type PartySocket from "partysocket";
import { client } from "../utils/honoClient";

interface RoomContentProps {
  roomId: string;
  presentationId: string;
  token: string;
  sessionToken: string;
  roomRole: string;
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
        onChatMessage(data);
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

function RoomContent({ roomId, presentationId, token, sessionToken, roomRole }: RoomContentProps) {

  const [socketConnected, setSocketConnected] = useState(false);
  const [slideContent, setSlideContent] = useState<MockSlideProps[]>([]);
  const [activePresentationId, setActivePresentationId] = useState(presentationId);
  const [slideImage, setSlideImage] = useState<string>('')
  const [currentSlide, setCurrentSlide] = useState(0)
  const [userCount, setUserCount] = useState(1)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const wsRef = useRef<PartySocket | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const slideCacheRef = useRef<Map<string, string>>(new Map());
  const [cachedPageIds, setCachedPageIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

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
    setChatMessages(prev => [...prev, msg])
  }, [])

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

  // Display the current slide — use cached blob URL if available, fall back to direct URL
  useEffect(() => {
    if (!slideContent.length || !activePresentationId) return

    const pageId = slideContent[currentSlide]?.pageId
    if (!pageId) return

    const cached = slideCacheRef.current.get(pageId)
    if (cached) {
      setSlideImage(cached)
    } else {
      // Fallback while cache is warming up (also used for mock API)
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
    <div className="flex flex-col lg:flex-row h-auto lg:h-[calc(100vh-80px)] w-full gap-3 sm:gap-4 p-2 sm:p-4">
     
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
          wsRef={wsRef}
        />
      )}

      {socketConnected ? (
        <>
          <div className="w-full aspect-video lg:aspect-auto lg:flex-1 flex flex-col bg-gray-900 rounded-lg overflow-hidden">
            <div className="flex-1 relative flex items-center justify-center overflow-hidden">
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
                  className="btn btn-circle btn-sm sm:btn-md bg-white/80 hover:bg-white pointer-events-auto"
                  onClick={() => setCurrentSlide(prev => Math.max(0, prev - 1))}
                  disabled={currentSlide === 0}
                >
                  ❮
                </button>
                <button
                  className="btn btn-circle btn-sm sm:btn-md bg-white/80 hover:bg-white pointer-events-auto"
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

        
          <div className="w-full lg:w-80 h-72 sm:h-80 lg:h-auto flex flex-col bg-white rounded-lg border border-gray-200 shadow-sm">
            
            <div className="flex items-center justify-between px-3 sm:px-4 py-2 sm:py-3 border-b border-gray-200 bg-gray-50 rounded-t-lg shrink-0">
              <h3 className="font-semibold text-gray-800 text-sm sm:text-base">Chat</h3>
              <div className="flex items-center gap-2 text-xs sm:text-sm text-gray-600">
                <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                <span>{userCount} {userCount === 1 ? 'user' : 'users'} online</span>
              </div>
            </div>

          
            <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 min-h-0">
              {chatMessages.length === 0 ? (
                <p className="text-gray-400 text-center text-sm">No messages yet</p>
              ) : (
                chatMessages.map((msg) => (
                  <div key={msg.id} className="flex flex-col">
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium text-sm text-gray-800">{msg.userName}</span>
                      <span className="text-xs text-gray-400">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600">{msg.message}</p>
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>

 
            <div className="p-2 sm:p-3 border-t border-gray-200 shrink-0">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
                  placeholder="Type a message..."
                  className="flex-1 input input-bordered input-sm"
                />
                <button
                  onClick={handleSendChat}
                  disabled={!chatInput.trim()}
                  className="btn btn-primary btn-sm"
                >
                  Send
                </button>
              </div>
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