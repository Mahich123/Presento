import Header from "./Header"

export default function Home() {

    return (
        <div className="min-h-screen">
            <Header />
            <div className="flex flex-col items-center justify-center min-h-[calc(100vh-80px)] px-6">
                <div className="text-center mb-8 max-w-3xl">
                    <h1 className="text-8xl font-extrabold mb-4 mt-16 text-[#BB8856] tracking-wide">Presento</h1>
                    <p className="text-[#998C8C] text-2xl font-semibold mb-4">Where Teaching and Learning Come Together,</p>
                    <p className="text-[#998C8C] text-2xl font-semibold mb-12">Where instruction meets inspiration.</p>
                </div>

                <div className="relative group w-full max-w-5xl">
                    <div className="absolute -inset-2 bg-gradient-to-r from-[#BB8856] to-[#D4A574] rounded-2xl blur opacity-25 group-hover:opacity-40 transition duration-500"></div>
                    <img
                        src="/slideimg.jpg"
                        alt="Presentation slide"
                        className="relative w-full h-auto rounded-2xl shadow-2xl border-4 border-white transition-transform duration-500 group-hover:scale-[1.02]"
                    />
                </div>
            </div>
        </div>
    )
}