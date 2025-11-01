import Header from "./Header"
import userAuth from "../utils/userSession"
import { useEffect, useState } from "react"
import { hc } from "hono/client"
import { useNavigate } from "@tanstack/react-router"
import { nanoid } from "nanoid";
import CollaborationRoom from "./CollaborationRoom";
import type { AppType } from "../../../server/src"

const client = hc<AppType>("http://192.168.1.9:3001/")

export default function Dashboard() {
  const { session, isPending } = userAuth()
  const [roomId, setRoomId] = useState<string>("")
  const [ , setRespData] = useState<string>("")
  const [joinRoomId, setJoinRoomId] = useState<string>("")
  const navigate = useNavigate()

  useEffect(() => {
    if (!session && !isPending) {
      navigate({
        to: "/"
      });
    }
  }, [session, isPending, navigate]);


  useEffect(() => {
    const storedRoomId = localStorage.getItem("roomId");

    if (storedRoomId) {
      setRoomId(storedRoomId);
    }
  }, [])

  if (isPending) {
    return <div>Loading...</div>
  }

  const handleCreateRoom = async () => {
    const newRoomId = nanoid(5)
    try {
      const connectPartyKit = await client.api.party[":roomId"].$post({
        param: { roomId: newRoomId },
      });

      const res = await connectPartyKit.text();
      console.log("res", res);
      setRespData(res);
      setRoomId(newRoomId);
      localStorage.setItem("roomId", newRoomId);
    } catch (error) {
      console.error("Error connecting to PartyKit:", error);
    }
  }

  const handleJoinRoom = () => {
    if(joinRoomId.trim()) {
      setRoomId(joinRoomId)
      localStorage.setItem('roomId', joinRoomId)
    } else {
      console.log('Please enter a valid room ID')
    }
  }


  return (
    <div>
      <Header />
      {
        !roomId ? (
          <div className="flex flex-col items-center justify-center min-h-[80vh]">
            <div className="card bg-white w-full max-w-md shadow-lg rounded-xl border border-gray-200">
              <div className="card-body p-8">
                <div className="flex items-center justify-between w-full gap-4">
                  <div className="flex flex-col  gap-2 flex-1">
                    <input
                      type="text"
                      placeholder="Enter Room Code"
                      className="input input-bordered w-full px-4 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400"
                      value={joinRoomId}
                      onChange={(e) => setJoinRoomId(e.target.value)}
                   />
                    <button className="btn btn-neutral px-4 py-2 font-medium" onClick={handleJoinRoom}>Join Room</button>
                    <div className="divider">OR</div>
                    <button className="btn btn-soft btn-primary px-4 py-2 font-medium whitespace-nowrap" onClick={handleCreateRoom}>Create Room</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <CollaborationRoom />
        )
      }
    </div>
  )
}