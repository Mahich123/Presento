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
    return (
      <div className="flex h-screen flex-col bg-base-200">
        <Header />
        <div className="flex flex-1 items-center justify-center">
          <span className="loading loading-spinner text-base-content/40" />
          <span className="sr-only">Loading your dashboard</span>
        </div>
      </div>
    )
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