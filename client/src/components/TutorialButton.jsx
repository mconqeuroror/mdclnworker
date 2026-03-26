import { useState } from "react";
import { createPortal } from "react-dom";
import { HelpCircle, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";

/**
 * TutorialButton - Shows tutorial video in modal
 *
 * @param {Object} tutorial - Tutorial config object
 * @param {string} tutorial.title - Tutorial title
 * @param {string} tutorial.youtubeId - YouTube video ID
 * @param {string} tutorial.description - Short description
 */
export default function TutorialButton({ tutorial, showWhenMissing = false, missingMessage = "Coming soon" }) {
  const [isOpen, setIsOpen] = useState(false);

  if (!tutorial && !showWhenMissing) return null;

  const handleOpen = (e) => {
    e.stopPropagation();
    if (!tutorial?.videoUrl && !tutorial?.youtubeId) {
      toast(missingMessage);
      return;
    }
    setIsOpen(true);
  };

  const handleClose = () => {
    setIsOpen(false);
  };

  // Close on ESC key
  const handleKeyDown = (e) => {
    if (e.key === "Escape") {
      handleClose();
    }
  };

  return (
    <>
      {/* Tutorial Button - using div with role="button" to avoid nesting buttons */}
      <div
        onClick={handleOpen}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && handleOpen(e)}
        className="group/tut relative inline-flex items-center justify-center w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 transition-all duration-200 hover:scale-110 cursor-pointer"
        title="Watch tutorial"
        aria-label="Watch tutorial"
      >
        <HelpCircle className="w-4 h-4 text-gray-400 group-hover/tut:text-white transition-colors" />

        <span className="absolute inset-0 rounded-full bg-white/10 opacity-0 group-hover/tut:opacity-100 transition-opacity duration-300" />
      </div>

      {/* Modal - Rendered via Portal */}
      {isOpen && tutorial &&
        createPortal(
          <AnimatePresence>
            <>
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={handleClose}
                className="fixed inset-0 bg-black/90 backdrop-blur-md z-[9998]"
                onKeyDown={handleKeyDown}
                tabIndex={0}
              />

              {/* Modal Content */}
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ type: "spring", duration: 0.3 }}
                className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
              >
                <div
                  className="relative w-full max-w-4xl glass-ultra rounded-2xl overflow-hidden shadow-2xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between p-6 border-b border-white/10">
                    <div>
                      <h3 className="text-xl font-bold text-white">
                        {tutorial.title}
                      </h3>
                      {tutorial.description && (
                        <p className="text-sm text-slate-400 mt-1">
                          {tutorial.description}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={handleClose}
                      className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                      aria-label="Close tutorial"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Video Embed - Supports YouTube or direct video URL */}
                  <div
                    className="relative w-full bg-black"
                    style={{ paddingBottom: "56.25%" }}
                  >
                    {tutorial.videoUrl ? (
                      <video
                        key={tutorial.videoUrl}
                        className="absolute inset-0 w-full h-full object-contain"
                        src={tutorial.videoUrl}
                        controls
                        preload="metadata"
                        playsInline
                      />
                    ) : (
                      <iframe
                        className="absolute inset-0 w-full h-full"
                        src={`https://www.youtube.com/embed/${tutorial.youtubeId}?autoplay=0&rel=0`}
                        title={tutorial.title}
                        frameBorder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    )}
                  </div>

                  {/* Footer */}
                  <div className="p-4 border-t border-white/10 bg-white/5">
                    <p className="text-xs text-gray-400 text-center">
                      Press{" "}
                      <kbd className="px-2 py-1 bg-white/10 rounded">ESC</kbd>{" "}
                      or click outside to close
                    </p>
                  </div>
                </div>
              </motion.div>
            </>
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
