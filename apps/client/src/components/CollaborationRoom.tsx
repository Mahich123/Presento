import { useCallback, useEffect, useRef, useState } from "react"
import { authClient } from "../lib/auth-client"
import { client } from "../utils/honoClient"
import userAuth from "../utils/userSession"
import { nanoid } from "nanoid"
import RoomContent from "./RoomContent"
import RoomQR from "./RoomQR"
import Toast from "./Toast"
import { useNavigate } from "@tanstack/react-router"
import { clearLoadedSet, deleteSet, getLoadedSet, type QuestionSet } from "../utils/questionSets"

const GOOGLE_SLIDES_MIME = 'application/vnd.google-apps.presentation'
const PDF_MIME = 'application/pdf'
const CONVERTIBLE_PRESENTATION_MIMES = [
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
    'application/vnd.ms-powerpoint', // .ppt
]

// File types RoomContent can display: native Slides (converted target), and PDF
// (rendered client-side with pdf.js). Cached picks of other types are dropped.
const DISPLAYABLE_MIMES = [GOOGLE_SLIDES_MIME, PDF_MIME]

// The Google Slides API can only read native Google Slides files. An uploaded
// PowerPoint has a Drive file id but a different mime type, so we copy it into a
// native Slides file (Drive converts on copy) and load that instead. Returns the
// presentation id to hand to load_slide.
async function ensureGoogleSlidesId(
    file: { id: string; name?: string; mimeType?: string },
    token: string,
): Promise<string> {
    if (file.mimeType === GOOGLE_SLIDES_MIME) return file.id

    if (file.mimeType && CONVERTIBLE_PRESENTATION_MIMES.includes(file.mimeType)) {
        const res = await fetch(
            `https://www.googleapis.com/drive/v3/files/${file.id}/copy?fields=id`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: `${file.name ?? 'Presentation'} (Presento)`,
                    mimeType: GOOGLE_SLIDES_MIME,
                }),
            },
        )
        if (!res.ok) {
            const err = await res.json().catch(() => null)
            throw new Error(
                err?.error?.message ||
                    'Could not convert this PowerPoint to Google Slides. Reconnect Google and try again.',
            )
        }
        const created = (await res.json()) as { id: string }
        return created.id
    }

    throw new Error(
        'This file type is not supported. Please pick a Google Slides or PowerPoint (.pptx) file.',
    )
}
const restoreAttempted = new Set<string>()

let justLeftRoomId = ''

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
    const [pendingRejoinRoomId, setPendingRejoinRoomId] = useState<string>("")
    const [isJoiningFromPrompt, setIsJoiningFromPrompt] = useState(false)
    const [showLeaveConfirmModal, setShowLeaveConfirmModal] = useState(false)
    const [setToReview, setSetToReview] = useState<QuestionSet | null>(null)
    const [roomRole, setRoomRole] = useState<'host' | 'viewer' | ''>('')
    const [toast, setToast] = useState<{ message: string; type: 'info' | 'success' | 'error' } | null>(null)
    const storedRoomIdKey = 'roomId'
    const rejoinResolvedRef = useRef(false)
    const storedSelectedFilesKey = 'selectedFiles'
    const storedSelectedFilesRoomKey = 'selectedFilesRoomId'
    const suppressRejoinPromptKey = 'suppressRejoinPrompt'

    const showToast = useCallback((message: string, type: 'info' | 'success' | 'error' = 'info') => {
        setToast({ message, type })
        setTimeout(() => setToast(null), 3000)
    }, [])

    const normalizeRole = (role: unknown, fallback: 'host' | 'viewer' = 'viewer'): 'host' | 'viewer' => {
        if (role === 'host' || role === 'viewer') return role
        return fallback
    }

    const handleConnect = async () => {
        sessionStorage.setItem(suppressRejoinPromptKey, '1')
        // linkSocial attaches Google to the signed-in user (GitHub or otherwise)
        // without switching the session. signIn.social would run a normal login,
        // which resolves to whatever user the Google identity belongs to instead.
        return await authClient.linkSocial({
            provider: 'google',
            callbackURL: `${window.location.origin}/dashboard`
        })
    }

    const handleCreateRoom = async () => {
        const newRoomId = nanoid(5)
        const token = session?.session.token

        if (!token) {
            showToast("Sign in first to open a room.", 'error')
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
                setSelectedFiles([])
                rejoinResolvedRef.current = true
                setPendingRejoinRoomId('')
                localStorage.setItem(storedRoomIdKey, newRoomId)
                setRoomRole(normalizeRole(res.role, 'host'))
                setShowModal(true)
                navigate({ to: '/dashboard', search: { roomId: newRoomId } })
            } else {
                const errorText = await response.text()
                console.error('Server error:', errorText)
                showToast("Could not open the room. Try again.", 'error')
            }
        } catch (error) {
            console.error('Error creating room:', error)
            showToast("No connection. Check your network and try again.", 'error')
        } finally {
            setIsCreatingRoom(false)
        }
    }

    const joinRoomById = useCallback(async (targetRoomId: string): Promise<'ok' | 'gone' | 'retry'> => {
        const trimmedRoomId = targetRoomId.trim()
        if (!trimmedRoomId) {
            showToast("Please enter a valid room ID to join.", 'error')
            return 'retry'
        }

        const token = session?.session.token

        if (!token) {
            showToast("You must be logged in to join a room.", 'error')
            return 'retry'
        }

        try {
            const response = await client.api.party[":roomId"].$post({
                param: { roomId: trimmedRoomId },
                json: { isJoining: true }
            })

            if (response.ok) {
                const res = await response.json()
                setRoomId(trimmedRoomId)
                setSelectedFiles([])
                setRoomRole(normalizeRole(res.role, 'viewer'))

                justLeftRoomId = ''
                rejoinResolvedRef.current = true
                setPendingRejoinRoomId('')
                localStorage.setItem(storedRoomIdKey, trimmedRoomId)
                const currentRoomInUrl = new URLSearchParams(window.location.search).get('roomId')
                if (currentRoomInUrl !== trimmedRoomId) {
                    navigate({ to: '/dashboard', search: { roomId: trimmedRoomId } })
                }
                return 'ok'
            } else {
                const errorText = await response.text()
                console.error('Server error:', errorText)
                try {
                    const errorJson = JSON.parse(errorText)
                    showToast(errorJson.error || "Failed to join room. Please try again.", 'error')
                } catch {
                    showToast(errorText || "Failed to join room. Please try again.", 'error')
                }
                return response.status === 404 ? 'gone' : 'retry'
            }
        } catch (error) {
            console.error('Error joining room:', error)
            showToast("Network error. Please try again.", 'error')
        }
        return 'retry'
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
        if (!roomId) return
        const storedRoomForFiles = localStorage.getItem(storedSelectedFilesRoomKey)
        const storedSelected = localStorage.getItem(storedSelectedFilesKey)
        if (storedRoomForFiles !== roomId || !storedSelected) {
            setSelectedFiles([])
            localStorage.removeItem(storedSelectedFilesKey)
            localStorage.removeItem(storedSelectedFilesRoomKey)
            return
        }
        try {
            const parsed = JSON.parse(storedSelected)
            if (Array.isArray(parsed)) {
                // Only restore native Google Slides files. Older cached picks (e.g. a
                // raw .pptx from before auto-conversion) would fail load_slide on every
                // reload, so drop them and force a fresh pick that runs conversion.
                const usable = parsed.filter((f) => f && DISPLAYABLE_MIMES.includes(f.mimeType))
                if (usable.length) {
                    setSelectedFiles(usable)
                } else {
                    setSelectedFiles([])
                    localStorage.removeItem(storedSelectedFilesKey)
                    localStorage.removeItem(storedSelectedFilesRoomKey)
                }
            }
        } catch {
            setSelectedFiles([])
            localStorage.removeItem(storedSelectedFilesKey)
            localStorage.removeItem(storedSelectedFilesRoomKey)
        }
    }, [roomId])

    useEffect(() => {
        const token = session?.session.token
        if (rejoinResolvedRef.current) return
        if (!token || roomId || pendingRejoinRoomId) return

        const queryRoomId = new URLSearchParams(window.location.search).get('roomId')?.trim() ?? ''
        const storedRoomId = localStorage.getItem(storedRoomIdKey)?.trim() ?? ''
        if (queryRoomId) {
            if (queryRoomId === justLeftRoomId) {
                setPendingRejoinRoomId(queryRoomId)
                navigate({ to: '/dashboard', search: {} })
                return
            }
            if (restoreAttempted.has(queryRoomId)) return
            restoreAttempted.add(queryRoomId)
            void joinRoomById(queryRoomId).then((result) => {
                if (result === 'ok') return
                // Bounce off the dead URL either way, but only forget the room
                // when it's truly gone. On a retryable failure we keep the id
                // so the rejoin prompt can offer it again.
                restoreAttempted.delete(queryRoomId)
                if (result === 'gone') {
                    localStorage.removeItem(storedRoomIdKey)
                } else {
                    localStorage.setItem(storedRoomIdKey, queryRoomId)
                    rejoinResolvedRef.current = false
                    setPendingRejoinRoomId(queryRoomId)
                }
                navigate({ to: '/dashboard', search: {} })
            })
            return
        }
        if (!storedRoomId || rejoinResolvedRef.current) return

        const suppressRejoinPrompt = sessionStorage.getItem(suppressRejoinPromptKey) === '1'
        if (suppressRejoinPrompt) {
            sessionStorage.removeItem(suppressRejoinPromptKey)
            const attemptAutoRejoin = async () => {
                const result = await joinRoomById(storedRoomId)
                if (result === 'retry') {
                    setPendingRejoinRoomId(storedRoomId)
                } else if (result === 'gone') {
                    localStorage.removeItem(storedRoomIdKey)
                }
            }
            void attemptAutoRejoin()
            return
        }

        setPendingRejoinRoomId(storedRoomId)
    }, [joinRoomById, navigate, session?.session.token, roomId, pendingRejoinRoomId])

    const handleRequestLeaveRoom = useCallback(() => {
        setShowLeaveConfirmModal(true)
    }, [])
    const reviewLoadedSet = useCallback(() => {
        const loaded = getLoadedSet()
        clearLoadedSet()
        if (loaded && roomRole === 'host') setSetToReview(loaded)
    }, [roomRole])

    const handleConfirmLeaveRoom = useCallback(() => {
        const leavingRoomId = roomId
        justLeftRoomId = leavingRoomId
        rejoinResolvedRef.current = false
        restoreAttempted.clear()
        setShowLeaveConfirmModal(false)
        setRoomId('')
        setRoomRole('')
        setSelectedFiles([])
        setPendingRejoinRoomId(leavingRoomId)
        localStorage.setItem(storedRoomIdKey, leavingRoomId)
        localStorage.removeItem(storedSelectedFilesKey)
        localStorage.removeItem(storedSelectedFilesRoomKey)
        reviewLoadedSet()
        navigate({ to: '/dashboard', search: {} })
        void leaveRoomById(leavingRoomId)
    }, [leaveRoomById, navigate, roomId, reviewLoadedSet])

    const handleCancelRejoin = useCallback(() => {
        const staleRoomId = pendingRejoinRoomId
        justLeftRoomId = ''
        rejoinResolvedRef.current = true
        restoreAttempted.clear()
        setPendingRejoinRoomId('')
        setRoomJoinId('')
        localStorage.removeItem(storedRoomIdKey)
        localStorage.removeItem(storedSelectedFilesKey)
        localStorage.removeItem(storedSelectedFilesRoomKey)
        navigate({ to: '/dashboard', search: {} })
        void leaveRoomById(staleRoomId)
    }, [leaveRoomById, navigate, pendingRejoinRoomId])

    const handleRoomClosed = useCallback((reason?: string) => {
        const closedRoomId = roomId
        const isRecoverable = reason === 'host_timeout' && roomRole === 'host'
        justLeftRoomId = isRecoverable ? closedRoomId : ''
        rejoinResolvedRef.current = !isRecoverable
        restoreAttempted.clear()
        setShowLeaveConfirmModal(false)
        reviewLoadedSet()
        setRoomId('')
        setRoomRole('')
        setSelectedFiles([])
        setPendingRejoinRoomId(isRecoverable ? closedRoomId : '')
        if (!isRecoverable) localStorage.removeItem(storedRoomIdKey)
        localStorage.removeItem(storedSelectedFilesKey)
        localStorage.removeItem(storedSelectedFilesRoomKey)
        navigate({ to: '/dashboard', search: {} })
        if (reason === 'host_timeout') {
            showToast(
                isRecoverable
                    ? 'Room closed while you were away. You can reopen it.'
                    : 'Room closed because host did not return in time.',
                'info'
            )
            return
        }
        
        if (reason === 'join_denied') {
            showToast("The host didn't let you into that room.", 'error')
            return
        }
        if (reason === 'join_no_answer') {
            showToast("The host didn't respond to your request. Try again in a moment.", 'info')
            return
        }
        showToast('Room closed.', 'info')
    }, [navigate, showToast, reviewLoadedSet, roomId, roomRole])

    const handleConfirmRejoin = useCallback(async () => {
        if (!pendingRejoinRoomId) return
        setIsJoiningFromPrompt(true)
        const result = await joinRoomById(pendingRejoinRoomId)
        if (result === 'ok') {
            setPendingRejoinRoomId('')
        } else if (result === 'gone') {
            localStorage.removeItem(storedRoomIdKey)
            localStorage.removeItem(storedSelectedFilesKey)
            localStorage.removeItem(storedSelectedFilesRoomKey)
            setPendingRejoinRoomId('')
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
            if (getToken.status === 401) {
                // The refresh token itself is dead (revoked, or rejected by Google
                // as unauthorized_client) — no amount of retrying will fix this.
                // Drop the connected state so "Connect Google Drive" reappears;
                // handleConnect silently rejoins this room after the OAuth
                // round-trip, so this doesn't lose the room like it used to.
                setHasGoogle(false)
                setAccessToken('')
                showToast("Google connection expired. Click Connect Google Drive to relink.", 'error')
            } else {
                // A transient refresh failure shouldn't drop the connected state and
                // force a full reconnect. Let the user simply retry.
                showToast("Couldn't refresh Google access. Please try again.", 'error')
            }
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

            .setCallback(async (data: any) => {
                if (data.action !== google.picker.Action.PICKED) return

                const docs = (data.docs ?? []) as { id: string; name?: string; mimeType?: string }[]
                if (!docs.length) return

                const first = docs[0]
                let normalizedDocs = docs

                // PDFs are rendered client-side with pdf.js — pass them straight through.
                // Google Slides files load directly. Everything else (e.g. uploaded
                // PowerPoint) is converted to Google Slides so the Slides API can render it.
                if (first.mimeType !== GOOGLE_SLIDES_MIME && first.mimeType !== PDF_MIME) {
                    showToast('Converting to Google Slides…', 'info')
                    try {
                        const presentationId = await ensureGoogleSlidesId(first, newAccessToken)
                        normalizedDocs = [
                            { ...first, id: presentationId, mimeType: GOOGLE_SLIDES_MIME },
                            ...docs.slice(1),
                        ]
                        showToast('Converted — loading slides…', 'success')
                    } catch (err) {
                        showToast(err instanceof Error ? err.message : 'Conversion failed', 'error')
                        return
                    }
                }

                setSelectedFiles(normalizedDocs)
                localStorage.setItem(storedSelectedFilesKey, JSON.stringify(normalizedDocs))
                localStorage.setItem(storedSelectedFilesRoomKey, roomId)
            })


            .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)

            .setOrigin(window.location.origin)

            .build();

        picker.setVisible(true)

        setShowModal(false)
    };



    return (
        <div className={`flex flex-col h-full bg-base-200 relative ${(selectedFiles.length > 0 || roomId) ? '' : 'items-center justify-center overflow-y-auto px-5 bg-[radial-gradient(115%_70%_at_50%_-8%,var(--color-base-100),transparent_62%)]'}`}>

            {(selectedFiles.length > 0 || roomId) ? (
                <RoomContent
                    roomId={roomId}
                    presentationId={selectedFiles[0]?.id}
                    presentationMimeType={selectedFiles[0]?.mimeType}
                    token={accessToken}
                    sessionToken={session?.session.token ?? ''}
                    roomRole={roomRole}
                    onRequestLeave={handleRequestLeaveRoom}
                    onRoomClosed={handleRoomClosed}
                    onOpenPicker={openPicker}
                    onConnectGoogle={handleConnect}
                    hasGoogle={hasGoogle}
                    pickerReady={pickerApiLoaded}
                />
            ) :
                <div className="w-full max-w-lg px-1 py-10 sm:py-4">

                    {/* The room you were in used to arrive as a modal over an empty
                        page — an interruption before you had done anything. It is a
                        row you can act on or ignore. */}
                    {pendingRejoinRoomId ? (
                        <div className="mb-10 rounded-2xl border border-primary/35 bg-primary/[0.06] p-4 sm:p-5">
                            <p className="text-sm font-semibold">
                                {pendingRejoinRoomId === justLeftRoomId
                                    ? 'You left this room'
                                    : 'You still have a room open'}
                            </p>
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                                <span className="font-mono text-lg font-bold uppercase tracking-[0.2em] text-secondary dark:text-primary">
                                    {pendingRejoinRoomId}
                                </span>
                                <div className="flex items-center gap-1.5">
                                    <button
                                        className="btn btn-ghost btn-sm"
                                        onClick={handleCancelRejoin}
                                        disabled={isJoiningFromPrompt}
                                    >
                                        Dismiss
                                    </button>
                                    <button
                                        className="btn btn-primary btn-sm"
                                        onClick={handleConfirmRejoin}
                                        disabled={isJoiningFromPrompt}
                                    >
                                        {isJoiningFromPrompt
                                            ? <span className="loading loading-spinner loading-xs" />
                                            : 'Rejoin'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    ) : null}

                    <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-balance">
                        Ready when you are.
                    </h1>
                    <p className="mt-3 text-[0.95rem] leading-relaxed text-base-content/70 text-pretty">
                        Open a room and share the code with the class, or join one you
                        were given.
                    </p>

                    {/* Opening a room used to take two clicks: one to expand a card,
                        one to confirm. It is the whole reason the page exists. */}
                    <div className="mt-9">
                        <button
                            onClick={handleCreateRoom}
                            disabled={isCreatingRoom}
                            className="btn btn-primary h-14 min-h-14 w-full gap-2 text-base font-semibold"
                        >
                            {isCreatingRoom ? (
                                <>
                                    <span className="loading loading-spinner loading-sm" />
                                    Opening the room…
                                </>
                            ) : (
                                'Open a room'
                            )}
                        </button>
                        <p className="mt-3 text-sm text-base-content/70">
                            You host. A five-character code appears the moment it opens.
                        </p>
                    </div>

                    <div className="my-9 flex items-center gap-4">
                        <span className="h-px flex-1 bg-base-300" />
                        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-base-content/65">
                            or
                        </span>
                        <span className="h-px flex-1 bg-base-300" />
                    </div>

                    <form
                        onSubmit={(e) => { e.preventDefault(); handleJoinRoom() }}
                    >
                        <label
                            htmlFor="room-code"
                            className="block text-sm font-semibold"
                        >
                            Join with a code
                        </label>
                        <p className="mt-1 text-sm text-base-content/70">
                            The five characters the host read out.
                        </p>
                        <div className="mt-3 flex gap-2">
                            <input
                                id="room-code"
                                type="text"
                                inputMode="text"
                                autoComplete="off"
                                autoCapitalize="characters"
                                spellCheck={false}
                                maxLength={5}
                                placeholder="ABCDE"
                                value={roomJoinId}
                                onChange={(e) => setRoomJoinId(e.target.value.trim())}
                                className="input input-bordered h-12 min-h-12 flex-1 bg-base-100 font-mono text-lg font-bold uppercase tracking-[0.28em] placeholder:font-normal placeholder:tracking-[0.28em] placeholder:text-base-content/30"
                            />
                            <button
                                type="submit"
                                className="btn btn-outline btn-primary h-12 min-h-12 px-7 font-semibold"
                            >
                                Join
                            </button>
                        </div>
                    </form>
                </div>
            }

            <dialog className={`modal ${showModal ? 'modal-open' : ''}`}>
                <div className="modal-box mx-4 w-full max-w-md border border-base-300 bg-base-100">
                    <h3 className="text-lg font-bold">Your room is open</h3>
                    <p className="mt-1 text-sm text-base-content/70">
                        Read the code out, or let the class scan it.
                    </p>

                    {/* The code is the only thing anyone in the room needs from this
                        screen, so it is the largest thing on it. */}
                    <div className="mt-5 rounded-2xl border border-base-300 bg-base-200 p-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <span className="font-mono text-3xl font-bold uppercase tracking-[0.22em] text-secondary dark:text-primary">
                                {roomId}
                            </span>
                            <button
                                className="btn btn-sm btn-outline btn-primary h-10 min-h-10"
                                onClick={() => {
                                    navigator.clipboard.writeText(roomId)
                                    showToast('Room code copied.', 'success')
                                }}
                            >
                                Copy
                            </button>
                        </div>
                        {roomId ? (
                            <div className="mt-5 flex justify-center border-t border-base-300 pt-5">
                                <RoomQR roomId={roomId} tone="theme" />
                            </div>
                        ) : null}
                    </div>

                    <div className="mt-6 border-t border-base-300 pt-5">
                        <p className="text-sm font-semibold">Bring in your deck</p>
                        {(!hasGoogle || !accessToken) ? (
                            <>
                                <p className="mt-1 text-sm text-base-content/70">
                                    Presento only reads the file you pick — it never edits
                                    or creates anything in your Drive.
                                </p>
                                <button
                                    onClick={handleConnect}
                                    className="btn btn-primary mt-4 h-11 min-h-11 w-full"
                                >
                                    Connect Google Drive
                                </button>
                            </>
                        ) : (
                            <>
                                <p className="mt-1 text-sm text-base-content/70">
                                    Google Slides, PowerPoint, or a PDF.
                                </p>
                                <button
                                    onClick={openPicker}
                                    disabled={!pickerApiLoaded}
                                    className="btn btn-primary mt-4 h-11 min-h-11 w-full"
                                >
                                    {pickerApiLoaded ? 'Choose a deck from Drive' : 'Loading Drive…'}
                                </button>
                            </>
                        )}
                    </div>

                    <div className="modal-action">
                        <button className="btn btn-ghost h-11 min-h-11" onClick={() => setShowModal(false)}>
                            Not now
                        </button>
                    </div>
                </div>
            </dialog>

          
            <dialog className={`modal ${setToReview ? 'modal-open' : ''}`}>
                <div className="modal-box w-full max-w-md mx-4 border border-base-300 bg-base-100">
                    <h3 className="font-bold text-lg">Keep this question set?</h3>
                    <p className="py-3 text-sm text-base-content/70">
                        You used <strong>{setToReview?.title || 'Untitled set'}</strong> in this session.
                        Keep it for next time, or delete it now?
                    </p>
                    <div className="modal-action">
                        <button
                            className="btn btn-outline btn-error h-11 min-h-11"
                            onClick={() => {
                                if (setToReview) deleteSet(setToReview.id)
                                setSetToReview(null)
                                showToast('Question set deleted.', 'info')
                            }}
                        >
                            Delete
                        </button>
                        <button className="btn btn-primary h-11 min-h-11" onClick={() => setSetToReview(null)}>
                            Keep
                        </button>
                    </div>
                </div>
            </dialog>

            <dialog className={`modal ${showLeaveConfirmModal ? 'modal-open' : ''}`}>
                <div className="modal-box w-full max-w-md mx-4 border border-base-300 bg-base-100">
                    <h3 className="font-bold text-lg">Leave room?</h3>
                    <p className="py-3 text-sm text-base-content/70">
                        Are you sure you want to leave this room?
                    </p>
                    <div className="modal-action">
                        <button
                            className="btn h-11 min-h-11"
                            onClick={() => setShowLeaveConfirmModal(false)}
                        >
                            Cancel
                        </button>
                        <button
                            className="btn btn-error h-11 min-h-11"
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
