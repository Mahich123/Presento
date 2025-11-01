import { useNavigate } from "@tanstack/react-router"

export default function Home() {

    const navigate = useNavigate()
    return (
        <div className="flex flex-col items-center justify-center min-h-screen">
            <h1>Welcome to Presento</h1>
            <button className="btn btn-primary mt-4" onClick={() => navigate({to: "/signup"})}>Get Started</button>
        </div>
    )
}