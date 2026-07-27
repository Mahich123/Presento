import Header from "./Header"
import userAuth from "../utils/userSession"
import { useEffect, useRef } from "react"
import { useNavigate } from "@tanstack/react-router"
import CollaborationRoom from "./CollaborationRoom";

export default function Dashboard() {
  const { session, isPending } = userAuth()
  const navigate = useNavigate()
 
  const hasAuthed = useRef(false)
  if (session) hasAuthed.current = true

  useEffect(() => {
    if (!session && !isPending) {
      const roomId = new URLSearchParams(window.location.search).get("roomId")?.trim()
      navigate(roomId ? { to: "/signup", search: { roomId } } : { to: "/" });
    }
  }, [session, isPending, navigate]);

  if (isPending && !hasAuthed.current) {
    return <div>Loading...</div>
  }

  return (
    <div className="h-screen overflow-hidden flex flex-col">
      <Header />
      <div className="flex-1 overflow-hidden">
        <CollaborationRoom />
      </div>
    </div>
  )
}