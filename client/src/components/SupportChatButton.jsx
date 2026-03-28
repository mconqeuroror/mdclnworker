import { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Headphones, Send, ImagePlus } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useAuthStore } from "../store";
import { supportAPI } from "../services/api";
import toast from "react-hot-toast";
import { sound } from "../utils/sounds";

const INITIAL_GREETING = "Hi, how can I help you today?";
const TELEGRAM_SUPPORT_URL = "https://t.me/modelclonechat";

function extractAgentText(payload) {
  if (!payload) return "";
  if (typeof payload === "string") return payload;

  const direct =
    payload?.output ??
    payload?.message ??
    payload?.text ??
    payload?.response ??
    payload?.data?.output ??
    payload?.data?.message;
  if (typeof direct === "string" && direct.trim()) return direct;

  const values = Array.isArray(payload) ? payload : Object.values(payload);
  for (const v of values) {
    if (!v || typeof v !== "object") continue;
    const nested = v.output ?? v.message ?? v.text ?? v.response;
    if (typeof nested === "string" && nested.trim()) return nested;
  }

  try {
    return JSON.stringify(payload ?? {});
  } catch {
    return "Support agent replied, but response format was unexpected.";
  }
}

export default function SupportChatButton() {
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [sending, setSending] = useState(false);
  const [sessionStartedAt, setSessionStartedAt] = useState(null);
  const [clockNow, setClockNow] = useState(Date.now());
  const [hasUnreadReply, setHasUnreadReply] = useState(false);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const openRef = useRef(false);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const subscriptionStatus = String(user?.subscriptionStatus || "").toLowerCase();
  const hasSupportAccess =
    subscriptionStatus === "active" ||
    subscriptionStatus === "trialing" ||
    Boolean(user?.premiumFeaturesUnlocked) ||
    user?.role === "admin";

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  useEffect(() => scrollToBottom(), [messages]);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  useEffect(() => {
    if (!open || !sessionId || !sessionStartedAt) return;
    const id = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open, sessionId, sessionStartedAt]);

  const startSession = async () => {
    try {
      const { sessionId: sid } = await supportAPI.startChat();
      setSessionId(sid);
      setMessages([{ role: "assistant", text: INITIAL_GREETING }]);
      setSessionStartedAt(Date.now());
      setClockNow(Date.now());
    } catch (e) {
      console.error("Support start error:", e);
      toast.error(e.response?.data?.message || "Could not start support chat");
    }
  };

  const terminateSession = () => {
    setSessionId(null);
    setMessages([]);
    setInput("");
    setAttachments([]);
    setSessionStartedAt(null);
    setHasUnreadReply(false);
  };

  const onOpen = () => {
    setOpen(true);
    setHasUnreadReply(false);
    if (!sessionId) {
      terminateSession();
      startSession();
    }
  };

  const onClose = () => {
    setOpen(false);
  };

  const sendSupportMessage = async ({
    messageText,
    files = [],
    isEndOfChat = false,
    addUserBubble = true,
  }) => {
    const text = messageText?.trim();
    if (!sessionId || !text) return;
    if (sending) return;

    const userMessage = text;
    const filesToSend = [...files];
    if (addUserBubble) {
      setMessages((m) =>
        m.concat([
          {
            role: "user",
            text: userMessage,
            attachments: filesToSend.length ? filesToSend.map((f) => f.name) : undefined,
          },
        ])
      );
    }
    setSending(true);

    try {
      const res = await supportAPI.sendMessage(sessionId, userMessage, filesToSend, { isEndOfChat });
      if (isEndOfChat) {
        toast.success("Chat ended");
        terminateSession();
        onClose();
        return;
      }
      const agentText = extractAgentText(res);
      if (openRef.current) {
        setMessages((m) => m.concat([{ role: "assistant", text: agentText }]));
      } else {
        setHasUnreadReply(true);
        sound.playSuccess();
      }
    } catch (e) {
      if (isEndOfChat) {
        // End-of-chat notification is best-effort; don't block user close on webhook issues.
        console.warn("Support end-chat send failed, ignoring:", e?.response?.data || e?.message || e);
        toast.success("Chat ended");
        terminateSession();
        onClose();
        return;
      }
      console.error("Support send error:", e);
      const errMsg = e.response?.data?.message || "Failed to send message";
      toast.error(errMsg);
      setMessages((m) => m.concat([{ role: "assistant", text: `Sorry, something went wrong: ${errMsg}` }]));
    } finally {
      setSending(false);
    }
  };
  const onSend = async () => {
    const text = input.trim();
    // Image is only sent with a message, never alone; require text to send
    if (!sessionId || !text) return;
    const filesToSend = [...attachments];
    setInput("");
    setAttachments([]);
    await sendSupportMessage({ messageText: text, files: filesToSend, isEndOfChat: false });
  };

  const onEndChat = async () => {
    const endMessage = input.trim() || "Thanks, ending chat.";
    setInput("");
    setAttachments([]);
    await sendSupportMessage({
      messageText: endMessage,
      files: [],
      isEndOfChat: true,
      addUserBubble: true,
    });
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const onFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    const images = files.filter((f) => f.type.startsWith("image/"));
    // Max 1 image attachment at a time; new selection replaces any existing
    setAttachments((a) => images.slice(0, 1));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (index) => setAttachments((a) => a.filter((_, i) => i !== index));
  const canEndChat = !!sessionId && !!sessionStartedAt && clockNow - sessionStartedAt >= 60_000;

  // Do not hard-hide by local subscriptionStatus because stale mobile state
  // can incorrectly hide chat for valid subscribers. Backend still enforces access.
  // Keep this return after all hooks to preserve stable hook order across auth changes.
  if (!isAuthenticated || !hasSupportAccess) return null;

  return (
    <div
      className="fixed z-[120] flex flex-col items-end gap-3"
      style={{
        right: "max(1rem, env(safe-area-inset-right))",
        /* Above dashboard mobile tab bar when --dashboard-mobile-tab-stack is set */
        bottom:
          "max(max(1rem, env(safe-area-inset-bottom)), calc(var(--dashboard-mobile-tab-stack, 0px) + 0.75rem))",
      }}
      data-testid="support-chat-wrapper"
    >
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.15 }}
            className="flex flex-col w-[min(380px,calc(100vw-24px))] max-h-[min(520px,calc(100dvh-120px))] rounded-xl border border-white/10 bg-black overflow-hidden"
            data-testid="support-chat-panel"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
              <div className="flex items-center gap-2">
                <Headphones className="w-4 h-4 text-white" />
                <span className="text-sm font-medium text-white">Support</span>
              </div>
              <button
                onClick={onClose}
                className="w-6 h-6 rounded-lg flex items-center justify-center text-slate-500 hover:text-white transition-colors"
                data-testid="button-close-support"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto min-h-[200px] max-h-[280px] p-4 space-y-3">
              {!sessionId ? (
                <p className="text-slate-400 text-sm">Starting chat...</p>
              ) : (
                messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                        msg.role === "user"
                          ? "bg-white/10 text-white"
                          : "bg-white/5 text-slate-200"
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                      {msg.attachments && msg.attachments.length > 0 && (
                        <p className="text-xs text-slate-400 mt-1">
                          📎 {msg.attachments.join(", ")}
                        </p>
                      )}
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {attachments.length > 0 && (
              <div className="px-4 pb-2 flex flex-wrap gap-2">
                {attachments.map((f, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 rounded bg-white/10 px-2 py-1 text-xs text-white"
                  >
                    {f.name}
                    <button type="button" onClick={() => removeAttachment(i)} className="text-slate-400 hover:text-white">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="p-3 border-t border-white/10 flex gap-2 shrink-0">
              <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                className="hidden"
                onChange={onFileChange}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                title="Attach screenshot"
              >
                <ImagePlus className="w-4 h-4" />
              </button>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Type your message..."
                className="flex-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-white/20"
                disabled={!sessionId || sending}
              />
              <button
                type="button"
                onClick={onSend}
                disabled={!sessionId || sending || !input.trim()}
                className="w-9 h-9 rounded-lg flex items-center justify-center bg-white text-black disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
            <div className="px-3 pb-3">
              <a
                href={TELEGRAM_SUPPORT_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full h-9 rounded-lg border border-[#26A5E4]/40 text-[#7fd2ff] bg-[#26A5E4]/10 hover:bg-[#26A5E4]/15 text-sm inline-flex items-center justify-center"
              >
                Rather talk to a human?
              </a>
            </div>
            {canEndChat && (
              <div className="px-3 pb-3">
                <button
                  type="button"
                  onClick={onEndChat}
                  disabled={!sessionId || sending}
                  className="w-full h-9 rounded-lg border border-red-500/35 text-red-300 bg-red-500/10 hover:bg-red-500/15 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  End Chat
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={open ? onClose : onOpen}
        className="relative w-12 h-12 rounded-full bg-white text-black flex items-center justify-center transition-all active:scale-95 shadow-lg shadow-white/10"
        data-testid="button-open-support"
      >
        {!open && hasUnreadReply && (
          <span className="absolute -top-1 -right-1 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 border border-black/40" />
          </span>
        )}
        {open ? <X className="w-5 h-5" /> : <MessageCircle className="w-5 h-5" />}
      </button>
    </div>
  );
}
