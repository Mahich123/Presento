import { Ban, Check, Copy, Hand, Lock, MessageSquareOff, Users } from "lucide-react";
import { useState } from "react";
import type { JoinRequest } from "./RoomContent";

export interface Participant {
  userId: string;
  userName: string;
  role: string;
  isMuted: boolean;
}

interface RoomSettingsProps {
  roomId: string;
  participants: Participant[];
  chatEnabled: boolean;
  locked: boolean;
  currentUserId?: string;
  joinRequests: JoinRequest[];
  onToggleChat: (enabled: boolean) => void;
  onToggleLock: (locked: boolean) => void;
  onMuteUser: (userId: string) => void;
  onApproveJoin: (connId: string) => void;
  onDenyJoin: (connId: string) => void;
}

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 cursor-pointer ${
        on ? "bg-[#BB8856]" : "bg-gray-300"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
          on ? "translate-x-4" : ""
        }`}
      />
    </button>
  );
}

export default function RoomSettings({
  roomId,
  participants,
  chatEnabled,
  locked,
  currentUserId,
  joinRequests,
  onToggleChat,
  onToggleLock,
  onMuteUser,
  onApproveJoin,
  onDenyJoin,
}: RoomSettingsProps) {
  const [copied, setCopied] = useState(false);

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="flex-1 overflow-y-auto p-3 sm:p-4 min-h-0 space-y-5">
      {/* Room code */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Room</h4>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200">
          <span className="flex-1 font-mono text-sm text-gray-800">{roomId}</span>
          <button
            onClick={copyRoomId}
            className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 cursor-pointer"
          >
            {copied ? <Check className="size-3.5 text-green-600" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      {/* Controls */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Controls</h4>
        <div className="space-y-1">
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50">
            <MessageSquareOff className="size-4 text-gray-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-800">Chat</p>
              <p className="text-xs text-gray-400">
                {chatEnabled ? "Everyone can chat" : "Chat is off for viewers"}
              </p>
            </div>
            <Toggle on={chatEnabled} onChange={onToggleChat} label="Toggle chat" />
          </div>

          <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50">
            <Lock className="size-4 text-gray-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-800">Lock room</p>
              <p className="text-xs text-gray-400">
                {locked ? "New people must ask you to let them in" : "Anyone with the code can join"}
              </p>
            </div>
            <Toggle on={locked} onChange={onToggleLock} label="Toggle room lock" />
          </div>
        </div>
      </div>

      {/* Knocking — only ever non-empty while the room is locked. Placed above
          the roster so a waiting student isn't missed. */}
      {joinRequests.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2 flex items-center gap-1.5">
            <Hand className="size-3.5" />
            Waiting to join
            <span className="text-gray-400 font-normal normal-case">({joinRequests.length})</span>
          </h4>
          <div className="space-y-1.5">
            {joinRequests.map((req) => (
              <div
                key={req.connId}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200"
              >
                <span className="flex-1 min-w-0 text-sm text-gray-800 truncate">
                  {req.userName}
                </span>
                <button
                  onClick={() => onDenyJoin(req.connId)}
                  className="btn btn-xs btn-ghost text-gray-500"
                >
                  Deny
                </button>
                <button
                  onClick={() => onApproveJoin(req.connId)}
                  className="btn btn-xs text-white border-0"
                  style={{ background: "#BB8856" }}
                >
                  <Check className="size-3" />
                  Let in
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Participants */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2 flex items-center gap-1.5">
          <Users className="size-3.5" />
          People
          <span className="text-gray-400 font-normal normal-case">({participants.length})</span>
        </h4>
        <div className="space-y-0.5">
          {participants.map((p) => {
            const isYou = p.userId === currentUserId;
            const isHost = p.role === "host";
            return (
              <div key={p.userId} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50">
                <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                <span className="flex-1 truncate text-sm text-gray-700">
                  {isYou ? "You" : p.userName}
                  {isHost && (
                    <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#BB8856]">
                      host
                    </span>
                  )}
                </span>
                {/* No self-mute, no muting the host. */}
                {!isHost && !isYou && (
                  <button
                    onClick={() => onMuteUser(p.userId)}
                    className="p-1 shrink-0 tooltip tooltip-left cursor-pointer"
                    data-tip={p.isMuted ? "unmute" : "mute"}
                    aria-label={p.isMuted ? `Unmute ${p.userName}` : `Mute ${p.userName}`}
                  >
                    <Ban className={`size-4 ${p.isMuted ? "text-red-600" : "text-gray-400"}`} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
