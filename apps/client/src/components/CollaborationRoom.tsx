import { useEffect, useState } from "react"
import { authClient } from "../lib/auth-client"
import { client } from "../utils/honoClient"
import userAuth from "../utils/userSession"
import { nanoid } from "nanoid"
import RoomContent from "./RoomContent"
import Toast from "./Toast"
import { useNavigate } from "@tanstack/react-router"

export default function CollaborationRoom() {
    const navigate = useNavigate()
    const [hasGoogle, setHasGoogle] = useState(false)
    const [accessToken, setAccessToken] = useState<string>('')
    const { session } = userAuth()
    const [roomId, setRoomId] = useState<string>("")
    const [, setRespData] = useState<string>("")
    const [pickerApiLoaded, setPickerApiLoaded] = useState(false)
    const [selectedFiles, setSelectedFiles] = useState<any[]>([])
    const [showModal, setShowModal] = useState(false)
    const [roomJoinId, setRoomJoinId] = useState<string>("")
    const [isCreatingRoom, setIsCreatingRoom] = useState(false)
    const [roomRole, setRoomRole] = useState<'host' | 'viewer' | ''>('')
    const [toast, setToast] = useState<{ message: string; type: 'info' | 'success' | 'error' } | null>(null)

    const showToast = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
        setToast({ message, type })
        setTimeout(() => setToast(null), 3000)
    }
    console.log('selectedFiles',selectedFiles)

    const handleConnect = async () => {
        return await authClient.signIn.social({
            provider: 'google',
            callbackURL: `${window.location.origin}/dashboard`
        })
    }

    const handleCreateRoom = async () => {
        const newRoomId = nanoid(5)
        const token = session?.session.token

        if (!token) {
            alert("You must be logged in to create a room.")
            return
        }

        setIsCreatingRoom(true)

        try {
            const response = await fetch(`${import.meta.env.VITE_BACKEND_API_URL}/party/${newRoomId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                credentials: 'include',
                body: JSON.stringify({ isJoining: false })
            })

            if (response.ok) {
                const res = await response.json()
                setRespData(JSON.stringify(res))
                setRoomId(newRoomId)
                localStorage.setItem('roomId', newRoomId)
                setRoomRole(res.role || 'host')
                setShowModal(true)
                navigate({ to: '/dashboard', search: { roomId: newRoomId } })
            } else {
                const errorText = await response.text()
                console.error('Server error:', errorText)
                alert("Failed to create room. Please try again.")
            }
        } catch (error) {
            console.error('Error creating room:', error)
            alert("Network error. Please try again.")
        } finally {
            setIsCreatingRoom(false)
        }
    }

    const handleJoinRoom = async () => {
        if (!roomJoinId.trim()) {
            showToast("Please enter a valid room ID to join.", 'error')
            return
        }

        const token = session?.session.token

        if (!token) {
            showToast("You must be logged in to join a room.", 'error')
            return
        }

        try {
            const response = await fetch(`${import.meta.env.VITE_BACKEND_API_URL}/party/${roomJoinId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                credentials: 'include',
                body: JSON.stringify({ isJoining: true })
            })

            if (response.ok) {
                const res = await response.json()
                setRoomId(roomJoinId)
                setRoomRole(res.role || 'viewer')
                localStorage.setItem('roomId', roomJoinId)
                navigate({ to: '/dashboard', search: { roomId: roomJoinId } })
            } else {
                const errorText = await response.text()
                console.error('Server error:', errorText)
                try {
                    const errorJson = JSON.parse(errorText)
                    showToast(errorJson.error || "Failed to join room. Please try again.", 'error')
                } catch {
                    showToast(errorText || "Failed to join room. Please try again.", 'error')
                }
            }
        } catch (error) {
            console.error('Error joining room:', error)
            showToast("Network error. Please try again.", 'error')
        }
    }


    const checkGoogleLinked = async () => {
        const currentUserId = session?.user.id

        if (!currentUserId) {
            return "user not available"
        }
        const res = await client.api.getallAccounts[':userId'].$get({
            param: { userId: session.user.id }
        })
        const data = await res.json()

        setHasGoogle(Array.isArray(data) && data.some((acc: { providerId: string }) => acc.providerId === 'google'))

        setAccessToken(Array.isArray(data) ? (data.find((acc) => acc.providerId === 'google')?.accessToken ?? '') : '')
    }

    useEffect(() => {
        const script = document.createElement('script');
        script.src = 'https://apis.google.com/js/api.js';
        script.onload = () => {
            window.gapi.load('picker', () => {
                setPickerApiLoaded(true);
            });
        };
        document.body.appendChild(script);

        return () => {
            document.body.removeChild(script);
        };
    }, []);


    useEffect(() => {
        if (session?.user.id) {
            checkGoogleLinked()
        }
    }, [session?.user?.id])


    const openPicker = async () => {
        if (!pickerApiLoaded || !accessToken) {
            console.error('Picker not ready or no access token');
            return;
        }

        const getToken = await client.api.linkGoogle.$get()


        if (!getToken.ok) {
            console.error('Failed to get fresh token from server');
            setHasGoogle(false)
            return;
        }

        const data = await getToken.json()

        const newAccessToken = data.accessToken;

        if (!newAccessToken) {
            console.error('No access token received from server');
            return;
        }

        // Update the access token state with the fresh token
        setAccessToken(newAccessToken);

        const google = window.google;

        const picker = new google.picker.PickerBuilder()

            .addView(google.picker.ViewId.DOCS)
            .addView(google.picker.ViewId.DOCS_IMAGES)

            .setOAuthToken(newAccessToken)

            .setDeveloperKey(import.meta.env.VITE_DEVELOPER_KEY)

            .setCallback((data: any) => {
                if (data.action === google.picker.Action.PICKED) {
                    console.log('Picked files:', data.docs);
                    setSelectedFiles(data.docs);
                }
            })


            .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)

            .setOrigin(window.location.origin)

            .build();

        picker.setVisible(true)

        setShowModal(false)
    };



    return (
        <div className={`flex flex-col min-h-screen bg-gray-50 relative ${(selectedFiles.length > 0 || roomId) ? '' : 'items-center justify-center px-4'}`}>

            {(selectedFiles.length > 0 || roomId) ? (
                <RoomContent roomId={roomId} presentationId={selectedFiles[0]?.id} token={accessToken} sessionToken={session?.session.token ?? ''} roomRole={roomRole} />
            ) :

                <div className="mockup-window border border-base-300 bg-[#F9FAFB] w-full max-w-lg">
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-2 border-t border-base-300 p-6 sm:p-8">
                        <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
                            <input
                                type="text"
                                placeholder="Enter room ID"
                                value={roomJoinId}
                                onChange={(e) => setRoomJoinId(e.target.value)}
                                className="input input-bordered w-full sm:w-64"
                            />
                            <button
                                onClick={handleJoinRoom}
                                className="btn btn-primary disabled:btn-disabled w-full sm:w-auto"
                            >
                                Join Room
                            </button>
                        </div>

                        <div className="divider sm:divider-horizontal my-1 sm:my-0">OR</div>

                        <button
                            onClick={handleCreateRoom}
                            disabled={isCreatingRoom}
                            className="btn btn-secondary w-full sm:w-auto"
                        >
                            {isCreatingRoom ? (
                                <span className="loading loading-spinner loading-sm"></span>
                            ) : (
                                'Create Room'
                            )}
                        </button>
                    </div>
                </div>
            }

            <dialog className={`modal ${showModal ? 'modal-open' : ''}`}>
                <div className="modal-box w-full max-w-sm sm:max-w-xl md:max-w-2xl mx-4">
                    <h3 className="font-bold text-base sm:text-lg mb-4">Room Created Successfully! 🎉</h3>

                    <div className="space-y-4 mb-6">
                        <p className="text-sm sm:text-base"><strong>Room ID:</strong> <code className="bg-gray-100 px-2 py-1 rounded break-all">{roomId}</code></p>
                        <p className="text-xs sm:text-sm text-gray-600">Share this Room ID with your collaborators to join the session.</p>
                    </div>

                    <div className="divider">Add Files to Collaborate</div>

                    {!hasGoogle ? (
                        <div className="text-center py-4">
                            <p className="text-gray-600 mb-4 text-sm sm:text-base">
                                Connect your Google account to access Drive files for collaboration
                            </p>
                            <button
                                onClick={handleConnect}
                                className="bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm sm:text-base px-6 sm:px-8 py-2.5 sm:py-3 rounded-full transition-colors duration-200 cursor-pointer w-full sm:w-auto"
                            >
                                Connect Google Drive
                            </button>
                        </div>
                    ) : (
                        <div className="text-center py-4">
                            <div className="bg-green-100 text-green-800 p-3 rounded mb-4 inline-block text-sm sm:text-base">
                                ✅ Google Drive Connected
                            </div>
                            <br />
                            <button
                                onClick={openPicker}
                                disabled={!pickerApiLoaded}
                                className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium text-sm sm:text-base px-6 sm:px-8 py-2.5 sm:py-3 rounded-full transition-colors duration-200 cursor-pointer disabled:cursor-not-allowed w-full sm:w-auto"
                            >
                                {pickerApiLoaded ? '📁 Choose from Drive' : '⏳ Loading...'}
                            </button>
                        </div>
                    )}

                    <div className="modal-action flex-col sm:flex-row gap-2">
                        <button
                            className="btn btn-primary w-full sm:w-auto"
                            onClick={() => {
                                navigator.clipboard.writeText(roomId)
                                alert('Room ID copied to clipboard!')
                            }}
                        >
                            Copy Room ID
                        </button>
                        <button className="btn w-full sm:w-auto" onClick={() => setShowModal(false)}>Close</button>
                    </div>
                </div>
            </dialog>

            {toast ? (
                <Toast
                    message={toast.message}
                    onClose={() => setToast(null)}
                />
             ) : null}  



        </div>
    )
}