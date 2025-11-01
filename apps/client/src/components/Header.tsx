import userAuth from "../utils/userSession"

export default function Header() {

    const { session, signOut } = userAuth()


    const handleSignOut = async () => {
        try {
            return await signOut()
        } catch (error) {
            console.error('Sign out error:', error)
        }
    }
    return (
        <>
            {
                session ? (
                    <div className="navbar bg-base-100 shadow-sm md:px-22">
                        <div className="flex-1">
                            <a className="text-xl font-extrabold">Presento</a>
                        </div>
                        <div className="flex-none">
                            <div className="dropdown dropdown-end">
                                <div tabIndex={0} role="button" className="btn btn-ghost btn-circle avatar">
                                    <div className="w-10 rounded-full">
                                        <img
                                            alt="Tailwind CSS Navbar component"
                                            src={session?.user.image || 'https://www.gravatar.com/avatar/?d=mp'} />
                                    </div>
                                </div>
                                <ul
                                    className="menu menu-sm dropdown-content bg-base-100 rounded-box z-1 mt-3 w-52 p-2 shadow">
                                    <li>
                                        <a className="justify-between">
                                            Profile
                                            <span className="badge badge-outline">{session?.user.name}</span>
                                        </a>
                                    </li>
                                    <li><a>Settings</a></li>
                                    <li><button onClick={handleSignOut}>Logout</button></li>
                                </ul>
                            </div>
                        </div>
                    </div>
                ) : null
        }
        </>

    )
}