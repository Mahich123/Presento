import usePartySocket from "partysocket/react";
import { useEffect, useState, useRef } from "react";
import type PartySocket from "partysocket";

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

  console.log('slideContent', slideContent)

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

  const handleSlideContent = (slides: MockSlideProps[], pid?: string) => {
    setSlideContent(slides)
    if (pid) setActivePresentationId(pid)
  }

  const handleChatMessage = (msg: ChatMessage) => {
    setChatMessages(prev => [...prev, msg])
  }

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

  const slideData = async () => {
    if (!slideContent || slideContent.length === 0 || !activePresentationId) {
      return;
    }
    
    const imageUrl = `${import.meta.env.VITE_BACKEND_API_URL}/slideimage/${activePresentationId}/${slideContent[currentSlide]?.pageId}?roomId=${roomId}`;
    setSlideImage(imageUrl);
  }

  useEffect(() => {
    if (slideContent && slideContent.length > 0) {
      slideData()
      if (roomRole === 'host' && wsRef.current) {
        wsRef.current.send(JSON.stringify({
          type: 'slide_change',
          slideIndex: currentSlide
        }))
      }
    }

  }, [currentSlide, slideContent, activePresentationId, token, roomRole])


  return (
    <div className="flex h-[calc(100vh-80px)] w-full gap-4 p-4">
     
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
          <div className="flex-1 flex flex-col bg-gray-900 rounded-lg overflow-hidden">
            <div className="flex-1 relative flex items-center justify-center">
              {slideImage ? (
                <img
                  src={slideImage}
                  alt={`Slide ${currentSlide + 1}`}
                  className="max-w-full max-h-full object-contain"
                />
              ) : (
                <div className="text-gray-400">Loading slide...</div>
              )}
            
              <div className={`absolute left-4 right-4 top-1/2 flex -translate-y-1/2 justify-between pointer-events-none ${roomRole === 'viewer' ? 'hidden' : ''}`}>
                <button
                  className="btn btn-circle btn-sm bg-white/80 hover:bg-white pointer-events-auto"
                  onClick={() => setCurrentSlide(prev => Math.max(0, prev - 1))}
                  disabled={currentSlide === 0}
                >
                  ❮
                </button>
                <button
                  className="btn btn-circle btn-sm bg-white/80 hover:bg-white pointer-events-auto"
                  onClick={() => setCurrentSlide(prev => Math.min(slideContent.length - 1, prev + 1))}
                  disabled={currentSlide >= slideContent.length - 1}
                >
                  ❯
                </button>
              </div>
            </div>
         
            <div className="bg-gray-800 text-white text-center py-2 text-sm">
              Slide {currentSlide + 1} of {slideContent.length}
            </div>
          </div>

        
          <div className="w-80 flex flex-col bg-white rounded-lg border border-gray-200 shadow-sm">
            
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50 rounded-t-lg">
              <h3 className="font-semibold text-gray-800">Chat</h3>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                <span>{userCount} {userCount === 1 ? 'user' : 'users'} online</span>
              </div>
            </div>

          
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
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

 
            <div className="p-3 border-t border-gray-200">
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