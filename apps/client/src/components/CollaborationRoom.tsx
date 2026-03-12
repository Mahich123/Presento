import { useCallback, useEffect, useState } from "react"
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
    const [selectedCard, setSelectedCard] = useState<'create' | 'join' | null>(null)
    const [pendingRejoinRoomId, setPendingRejoinRoomId] = useState<string>("")
    const [isJoiningFromPrompt, setIsJoiningFromPrompt] = useState(false)
    const [showLeaveConfirmModal, setShowLeaveConfirmModal] = useState(false)
    const [roomRole, setRoomRole] = useState<'host' | 'viewer' | ''>('')
    const [toast, setToast] = useState<{ message: string; type: 'info' | 'success' | 'error' } | null>(null)

    const showToast = useCallback((message: string, type: 'info' | 'success' | 'error' = 'info') => {
        setToast({ message, type })
        setTimeout(() => setToast(null), 3000)
    }, [])

    const normalizeRole = (role: unknown, fallback: 'host' | 'viewer' = 'viewer'): 'host' | 'viewer' => {
        if (role === 'host' || role === 'viewer') return role
        return fallback
    }
    console.log('selectedFiles', selectedFiles)

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
            const response = await client.api.party[":roomId"].$post({
                param: { roomId: newRoomId },
                json: { isJoining: false }
            })

            if (response.ok) {
                const res = await response.json()
                setRespData(JSON.stringify(res))
                setRoomId(newRoomId)
                localStorage.setItem('roomId', newRoomId)
                setRoomRole(normalizeRole(res.role, 'host'))
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

    const joinRoomById = useCallback(async (targetRoomId: string) => {
        const trimmedRoomId = targetRoomId.trim()
        if (!trimmedRoomId) {
            showToast("Please enter a valid room ID to join.", 'error')
            return false
        }

        const token = session?.session.token

        if (!token) {
            showToast("You must be logged in to join a room.", 'error')
            return false
        }

        try {
            const response = await client.api.party[":roomId"].$post({
                param: { roomId: trimmedRoomId },
                json: { isJoining: true }
            })

            if (response.ok) {
                const res = await response.json()
                setRoomId(trimmedRoomId)
                setRoomRole(normalizeRole(res.role, 'viewer'))
                localStorage.setItem('roomId', trimmedRoomId)
                navigate({ to: '/dashboard', search: { roomId: trimmedRoomId } })
                return true
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
        return false
    }, [navigate, session?.session.token, showToast])

    const handleJoinRoom = async () => {
        await joinRoomById(roomJoinId)
    }

    const leaveRoomById = useCallback(async (targetRoomId: string) => {
        const token = session?.session.token
        if (!token || !targetRoomId.trim()) return

        try {
            await client.api.party[":roomId"].leave.$post({
                param: { roomId: targetRoomId }
            })
        } catch (error) {
            console.error('Error leaving room:', error)
        }
    }, [session?.session.token])


    const checkGoogleLinked = async () => {
        const currentUserId = session?.user.id

        if (!currentUserId) {
            return "user not available"
        }
        const res = await client.api.getallAccounts[':userId'].$get({
            param: { userId: session.user.id }
        })
        const data = await res.json()

        const googleAccount = Array.isArray(data)
            ? data.find((acc) => acc.providerId === 'google')
            : undefined
        const token = googleAccount?.accessToken ?? ''
        setHasGoogle(Boolean(googleAccount))
        setAccessToken(token)
    }

    useEffect(() => {
        const script = document.createElement('script');
        script.src = 'https://apis.google.com/js/api.js';
        script.onload = () => {
            const gapi = (window as Window & { gapi?: { load: (api: string, cb: () => void) => void } }).gapi
            gapi?.load('picker', () => {
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

    useEffect(() => {
        const token = session?.session.token
        if (!token || roomId || pendingRejoinRoomId) return

        const queryRoomId = new URLSearchParams(window.location.search).get('roomId')?.trim() ?? ''
        const storedRoomId = localStorage.getItem('roomId')?.trim() ?? ''
        const targetRoomId = queryRoomId || storedRoomId

        if (!targetRoomId) return

        setRoomJoinId(targetRoomId)
        setPendingRejoinRoomId(targetRoomId)
    }, [session?.session.token, roomId, pendingRejoinRoomId])

    const handleRequestLeaveRoom = useCallback(() => {
        setShowLeaveConfirmModal(true)
    }, [])

    const handleConfirmLeaveRoom = useCallback(() => {
        const leavingRoomId = roomId
        setShowLeaveConfirmModal(false)
        setRoomId('')
        setRoomRole('')
        setSelectedFiles([])
        setPendingRejoinRoomId('')
        localStorage.removeItem('roomId')
        navigate({ to: '/dashboard', search: {} })
        showToast('You left the room.', 'info')
        void leaveRoomById(leavingRoomId)
    }, [leaveRoomById, navigate, roomId, showToast])

    const handleCancelRejoin = useCallback(() => {
        const staleRoomId = pendingRejoinRoomId
        setPendingRejoinRoomId('')
        localStorage.removeItem('roomId')
        navigate({ to: '/dashboard', search: {} })
        void leaveRoomById(staleRoomId)
    }, [leaveRoomById, navigate, pendingRejoinRoomId])

    const handleRoomClosed = useCallback((reason?: string) => {
        setShowLeaveConfirmModal(false)
        setRoomId('')
        setRoomRole('')
        setSelectedFiles([])
        setPendingRejoinRoomId('')
        localStorage.removeItem('roomId')
        navigate({ to: '/dashboard', search: {} })
        if (reason === 'host_timeout') {
            showToast('Room closed because host did not return in time.', 'info')
            return
        }
        showToast('Room closed.', 'info')
    }, [navigate, showToast])

    const handleConfirmRejoin = useCallback(async () => {
        if (!pendingRejoinRoomId) return
        setIsJoiningFromPrompt(true)
        const ok = await joinRoomById(pendingRejoinRoomId)
        if (ok) {
            setPendingRejoinRoomId('')
        } else {
            localStorage.removeItem('roomId')
        }
        setIsJoiningFromPrompt(false)
    }, [joinRoomById, pendingRejoinRoomId])


    const openPicker = async () => {
        if (!hasGoogle) {
            showToast("Connect Google Drive first to use the picker.", 'error')
            return;
        }

        if (!pickerApiLoaded) {
            showToast("Google Picker is still loading. Please try again.", 'info')
            return;
        }

        if (!accessToken) {
            showToast("No Google access token found. Reconnect your Google account.", 'error')
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

        const google = (window as Window & { google?: any }).google;
        if (!google?.picker) {
            showToast("Google Picker is not available. Please try again.", 'error')
            return
        }

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
        <div className={`flex flex-col h-full bg-gray-50 relative ${(selectedFiles.length > 0 || roomId) ? '' : 'items-center justify-center px-4'}`}>

            {(selectedFiles.length > 0 || roomId) ? (
                <RoomContent
                    roomId={roomId}
                    presentationId={selectedFiles[0]?.id}
                    token={accessToken}
                    sessionToken={session?.session.token ?? ''}
                    roomRole={roomRole}
                    onRequestLeave={handleRequestLeaveRoom}
                    onRoomClosed={handleRoomClosed}
                    onOpenPicker={openPicker}
                    pickerReady={hasGoogle && pickerApiLoaded}
                />
            ) :
                <div className="w-full px-4 flex flex-col items-center py-8 sm:py-0">
                    <div className="text-center mb-8 sm:mb-10">
                        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-2">What's you wanna do today?</h1>
                        <p className="text-gray-500 text-sm max-w-md">
                            Ready to lead? Open a new room to present your ideas or join a session to contribute and make your mark.
                        </p>
                    </div>

                    <div className="w-full max-w-5xl flex flex-col sm:flex-row justify-center items-stretch sm:items-start gap-4 sm:gap-0">


                        <div className={`transition-all duration-500 ease-in-out overflow-hidden shrink-0 ${selectedCard === 'join'
                                ? 'max-h-0 opacity-0 -translate-y-2 pointer-events-none sm:max-h-none sm:w-0 sm:translate-y-0'
                                : selectedCard === 'create'
                                    ? 'w-full sm:w-96 max-h-128 opacity-100'
                                    : 'w-full sm:w-72 max-h-128 opacity-100'
                            }`}>
                            <div
                                className={`w-full bg-white rounded-2xl border p-5 sm:p-8 flex flex-col items-center text-center transition-all duration-500 ${selectedCard === 'create'
                                        ? 'border-blue-200 shadow-xl ring-2 ring-blue-100'
                                        : 'border-gray-100 shadow-sm hover:shadow-md hover:border-blue-200 cursor-pointer'
                                    }`}
                                onClick={() => selectedCard === null && setSelectedCard('create')}
                            >
                                <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-xl flex items-center justify-center mb-4 sm:mb-5 shrink-0 transition-colors duration-300 ${selectedCard === 'create' ? 'bg-blue-100' : 'bg-blue-50'}`}>
                                    <svg className="w-7 h-7 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                    </svg>
                                </div>
                                <h2 className="text-base sm:text-lg font-bold text-gray-800 mb-2">Create Room</h2>
                                <div className={`overflow-hidden transition-all duration-300 ${selectedCard === 'create'
                                        ? 'max-h-24 opacity-100 mt-1 delay-200'
                                        : 'max-h-0 opacity-0'
                                    }`}>
                                    <p className="text-sm text-gray-500 leading-relaxed">
                                        Start a new session. A unique room ID will be generated, share it with others so they can join.
                                    </p>
                                </div>


                                <div className={`w-full flex flex-col gap-3 overflow-hidden transition-all duration-300 ${selectedCard === 'create'
                                        ? 'max-h-40 opacity-100 mt-7 delay-300'
                                        : 'max-h-0 opacity-0 mt-0 pointer-events-none'
                                    }`}>
                                    <button
                                        onClick={handleCreateRoom}
                                        disabled={isCreatingRoom}
                                        className="w-full btn btn-primary rounded-xl"
                                    >
                                        {isCreatingRoom ? (
                                            <span className="loading loading-spinner loading-sm"></span>
                                        ) : (
                                            'Create Room'
                                        )}
                                    </button>
                                    <button
                                        onClick={() => setSelectedCard(null)}
                                        className="w-full btn btn-ghost btn-sm text-gray-400 rounded-xl"
                                    >
                                        ← Back
                                    </button>
                                </div>
                            </div>
                        </div>


                        <div className={`transition-all duration-500 ease-in-out overflow-hidden shrink-0 ${selectedCard !== null ? 'max-h-0 sm:w-0 opacity-0' : 'max-h-16 sm:max-h-none w-full sm:w-14 opacity-100'
                            }`}>
                            <div className="w-full sm:w-14 flex flex-row sm:flex-col items-center justify-center gap-2 py-1 sm:py-10">
                                <div className="h-px w-full sm:w-px sm:h-10 bg-gray-200"></div>
                                <span className="text-xs font-medium text-gray-400 bg-gray-100 px-2 py-1 rounded-full">OR</span>
                                <div className="h-px w-full sm:w-px sm:h-10 bg-gray-200"></div>
                            </div>
                        </div>


                        <div className={`transition-all duration-500 ease-in-out overflow-hidden shrink-0 ${selectedCard === 'create'
                                ? 'max-h-0 opacity-0 -translate-y-2 pointer-events-none sm:max-h-none sm:w-0 sm:translate-y-0'
                                : selectedCard === 'join'
                                    ? 'w-full sm:w-96 max-h-136 opacity-100'
                                    : 'w-full sm:w-72 max-h-136 opacity-100'
                            }`}>
                            <div
                                className={`w-full bg-white rounded-2xl border p-5 sm:p-8 flex flex-col items-center text-center transition-all duration-500 ${selectedCard === 'join'
                                        ? 'border-green-200 shadow-xl ring-2 ring-green-100'
                                        : 'border-gray-100 shadow-sm hover:shadow-md hover:border-green-200 cursor-pointer'
                                    }`}
                                onClick={() => selectedCard === null && setSelectedCard('join')}
                            >
                                <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-xl flex items-center justify-center mb-4 sm:mb-5 shrink-0 transition-colors duration-300 ${selectedCard === 'join' ? 'bg-green-100' : 'bg-green-50'}`}>
                                    <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                                    </svg>
                                </div>
                                <h2 className="text-base sm:text-lg font-bold text-gray-800 mb-2">Join Room</h2>
                                <div className={`overflow-hidden transition-all duration-300 ${selectedCard === 'join'
                                        ? 'max-h-24 opacity-100 mt-1 delay-200'
                                        : 'max-h-0 opacity-0'
                                    }`}>
                                    <p className="text-sm text-gray-500 leading-relaxed">
                                        Have a room ID? Enter it below to jump into an ongoing session as a viewer.
                                    </p>
                                </div>


                                <div className={`w-full flex flex-col gap-3 overflow-hidden transition-all duration-300 ${selectedCard === 'join'
                                        ? 'max-h-48 opacity-100 mt-7 delay-300'
                                        : 'max-h-0 opacity-0 mt-0 pointer-events-none'
                                    }`}>
                                    <input
                                        type="text"
                                        placeholder="Enter room ID"
                                        value={roomJoinId}
                                        onChange={(e) => setRoomJoinId(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleJoinRoom()}
                                        className="input input-bordered w-full rounded-xl text-sm outline-none"
                                    />
                                    <button
                                        onClick={handleJoinRoom}
                                        disabled={!roomJoinId.trim()}
                                        className="w-full btn btn-success text-black rounded-xl disabled:opacity-50"
                                    >
                                        Join Room
                                    </button>
                                    <button
                                        onClick={() => setSelectedCard(null)}
                                        className="w-full btn btn-ghost btn-sm text-gray-400 rounded-xl"
                                    >
                                        ← Back
                                    </button>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>
            }

            <dialog className={`modal ${showModal ? 'modal-open' : ''}`}>
                <div className="modal-box w-full max-w-sm sm:max-w-xl md:max-w-2xl mx-4">
                    <h3 className="font-bold text-base sm:text-lg mb-4">Room Created Successfully! 🎉</h3>

                    <div className="space-y-4 mb-6">
                        <p className="text-sm sm:text-base"><strong>Room ID:</strong> <code className="px-2 py-1 rounded break-all bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100">{roomId}</code></p>
                        <p className="text-xs sm:text-sm text-gray-600">Share this Room ID with your collaborators to join the session.</p>
                    </div>

                    <div className="divider">Add Files to Collaborate</div>

                    {(!hasGoogle || !accessToken) ? (
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

            <dialog className={`modal ${pendingRejoinRoomId ? 'modal-open' : ''}`}>
                <div className="modal-box w-full max-w-md mx-4">
                    <h3 className="font-bold text-lg">Rejoin room?</h3>
                    <p className="py-3 text-sm text-gray-600">
                        Room <code className="px-2 py-1 rounded bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100">{pendingRejoinRoomId}</code> is still in your session.
                        Do you want to rejoin this room?
                    </p>
                    <div className="modal-action">
                        <button
                            className="btn"
                            onClick={handleCancelRejoin}
                            disabled={isJoiningFromPrompt}
                        >
                            No
                        </button>
                        <button
                            className="btn btn-primary"
                            onClick={handleConfirmRejoin}
                            disabled={isJoiningFromPrompt}
                        >
                            {isJoiningFromPrompt ? (
                                <span className="loading loading-spinner loading-sm"></span>
                            ) : (
                                'Rejoin'
                            )}
                        </button>
                    </div>
                </div>
            </dialog>

            <dialog className={`modal ${showLeaveConfirmModal ? 'modal-open' : ''}`}>
                <div className="modal-box w-full max-w-md mx-4">
                    <h3 className="font-bold text-lg">Leave room?</h3>
                    <p className="py-3 text-sm text-gray-600">
                        Are you sure you want to leave this room?
                    </p>
                    <div className="modal-action">
                        <button
                            className="btn"
                            onClick={() => setShowLeaveConfirmModal(false)}
                        >
                            Cancel
                        </button>
                        <button
                            className="btn btn-error text-white"
                            onClick={handleConfirmLeaveRoom}
                        >
                            Leave
                        </button>
                    </div>
                </div>
            </dialog>

            {toast ? (
                <Toast
                    message={toast.message}
                    variant={toast.type}
                    onClose={() => setToast(null)}
                />
            ) : null}



        </div>
    )
}
