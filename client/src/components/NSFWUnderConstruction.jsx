import { useAuthStore } from "../store";
import { Flame, Construction } from "lucide-react";

/**
 * Renders children (the real NSFW studio) only for admins.
 * For non-admins, shows a friendly "under construction" message.
 */
export default function NSFWUnderConstruction({ children }) {
  const { user } = useAuthStore();
  const isAdmin = user?.role === "admin";

  if (isAdmin) {
    return children;
  }

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-6 py-12 text-center">
      <div
        className="flex flex-col items-center gap-6 max-w-md mx-auto p-8 rounded-2xl border border-white/10"
        style={{
          background: "linear-gradient(180deg, rgba(30,25,35,0.6) 0%, rgba(20,18,28,0.8) 100%)",
        }}
      >
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <Construction className="w-12 h-12 text-amber-400" aria-hidden />
        </div>
        <div className="flex items-center gap-2 text-amber-400/90">
          <Flame className="w-5 h-5" aria-hidden />
          <span className="font-semibold text-lg">NSFW Studio</span>
        </div>
        <p className="text-white/80 text-base leading-relaxed">
          NSFW is under construction and will be available soon. Thank you for your patience.
        </p>
      </div>
    </div>
  );
}
