import usePartySocket from "partysocket/react";
import { useEffect, useState } from "react";
import { client } from "../utils/honoClient";

interface RoomContentProps {
  roomId: string;
  presentationId: string;
  token: string;
  roomRole: string;
}

interface MockSlideProps {
  pageId: string;
  title: string;
}


interface SlideDataResponse {
  contentUrl?: string;
  mockText?: string;
  [key: string]: any;
}


function RoomContent({ roomId, presentationId, token, roomRole }: RoomContentProps) {

  const [socketConnected, setSocketConnected] = useState(false);
  const [, setMessages] = useState<string[]>([]);
  const partyKitConnect = import.meta.env.VITE_PARTYKIT_SERVER_URL
  const [slideContent, setSlideContent] = useState<MockSlideProps[]>([]);
  const [slideImage, setSlideImage] = useState<string>('')
  const [currentSlide, setCurrentSlide] = useState(0)
  const useMockApi = import.meta.env.VITE_USE_MOCK_API === 'true'


  useEffect(() => {
    if (useMockApi) {
      setSocketConnected(true)
      setTimeout(() => {
        const mockSlides: MockSlideProps[] = [
          { pageId: 'mock-page-1', title: 'Slide 1' },
          { pageId: 'mock-page-2', title: 'Slide 2' },
          { pageId: 'mock-page-3', title: 'Slide 3' }
        ]
        setSlideContent(mockSlides)
      }, 500)
    }
  }, [useMockApi])
  const ws = usePartySocket({

    host: partyKitConnect,
    room: roomId,

    onOpen() {
      setSocketConnected(true)

      ws.send(JSON.stringify({
        type: 'load_slide',
        presentationId: presentationId,
        token: token
      }))

    },
    onMessage(e) {
      const data = JSON.parse(e.data);

      if (data.type === 'slide_content') {
        setSlideContent(data.slides);
      } else if (data.type === 'slide_change') {
        setCurrentSlide(data.slideIndex);
      }
      setMessages((prevMessages) => [...prevMessages, e.data]);
    },
    onClose() {
      setSocketConnected(false)
    }
  })

  const slideData = async () => {

    if (!slideContent || slideContent.length === 0) return
    const res = await client.api.slideimage[":presentationId"][":pageObjectId"].$get(
      {
        param: {
          presentationId: presentationId,
          pageObjectId: slideContent[currentSlide]?.pageId
        }
      },
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );

    const data = await res.json() as SlideDataResponse

    if (data?.contentUrl) {
      setSlideImage(data?.contentUrl)
    } else if (data?.mockText) {
      setSlideImage(`data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="100%" height="100%" fill="%234F46E5"/><text x="50%" y="50%" font-size="48" fill="white" text-anchor="middle" dominant-baseline="middle">${encodeURIComponent(data.mockText)}</text></svg>`)
    }
    else {
      setSlideImage('')
    }
  }

  useEffect(() => {
    if (slideContent && slideContent.length > 0) {
      slideData()
      if (roomRole === 'host' && ws) {
        ws.send(JSON.stringify({
          type: 'slide_change',
          slideIndex: currentSlide
        }))
      }
    }
  }, [currentSlide, slideContent, token, roomRole, ws])


  return (
    <div>
      {socketConnected && ws ? (
        <div>
          <div className="slide-content">
            <div className="carousel w-full">
              <div id="slide1" className="carousel-item relative w-full">
                <img
                  src={slideImage}
                  className="w-full" />
                <div className={`absolute left-5 right-5 top-1/2 flex -translate-y-1/2 transform justify-between ${roomRole === 'viewer' ? 'hidden' : ''}`}>
                  <button 
                    className="btn btn-circle" 
                    onClick={() => setCurrentSlide(prev => Math.max(0, prev - 1))}
                    disabled={currentSlide === 0}
                  >
                    ❮
                  </button>
                  <button 
                    className="btn btn-circle" 
                    onClick={() => setCurrentSlide(prev => Math.min(slideContent.length - 1, prev + 1))}
                    disabled={currentSlide >= slideContent.length - 1}
                  >
                    ❯
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <p>Connecting to room...</p>
      )}
    </div>
  )
}

export default RoomContent;