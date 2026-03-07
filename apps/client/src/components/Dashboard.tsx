import Header from "./Header"
import userAuth from "../utils/userSession"
import { useEffect } from "react"
import { useNavigate } from "@tanstack/react-router"
import CollaborationRoom from "./CollaborationRoom";

export default function Dashboard() {
  const { session, isPending } = userAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!session && !isPending) {
      navigate({ to: "/" });
    }
  }, [session, isPending, navigate]);

  if (isPending) {
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