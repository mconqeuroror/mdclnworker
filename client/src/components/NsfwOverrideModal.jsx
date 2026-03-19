import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Shield, ShieldCheck, ShieldX, Loader2, Image as ImageIcon, Lock, LockOpen } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';

export default function NsfwOverrideModal({ isOpen, onClose, user, onSuccess }) {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState({});
  const [togglingLooks, setTogglingLooks] = useState({});

  useEffect(() => {
    if (isOpen && user) {
      loadModels();
    } else {
      setModels([]);
      setToggling({});
      setTogglingLooks({});
    }
  }, [isOpen, user]);

  const loadModels = async () => {
    setLoading(true);
    try {
      const response = await api.get(`/admin/users/${user.id}/models`);
      if (response.data.success) {
        setModels(response.data.models);
      }
    } catch (error) {
      toast.error('Failed to load models');
    } finally {
      setLoading(false);
    }
  };

  const toggleNsfw = async (modelId, currentState) => {
    setToggling(prev => ({ ...prev, [modelId]: true }));
    try {
      const response = await api.post(`/admin/models/${modelId}/nsfw-override`, {
        enabled: !currentState
      });
      
      if (response.data.success) {
        toast.success(response.data.message);
        setModels(prev => prev.map(m => 
          m.id === modelId ? { ...m, nsfwOverride: !currentState } : m
        ));
        onSuccess?.();
      }
    } catch (error) {
      toast.error('Failed to toggle NSFW');
    } finally {
      setToggling(prev => ({ ...prev, [modelId]: false }));
    }
  };

  const toggleLooksUnlock = async (modelId, currentState) => {
    setTogglingLooks(prev => ({ ...prev, [modelId]: true }));
    try {
      const response = await api.post(`/admin/models/${modelId}/looks-unlock`, {
        unlocked: !currentState
      });
      if (response.data.success) {
        toast.success(response.data.message);
        setModels(prev => prev.map(m =>
          m.id === modelId ? { ...m, looksUnlockedByAdmin: !currentState } : m
        ));
        onSuccess?.();
      }
    } catch (error) {
      toast.error('Failed to toggle model looks unlock');
    } finally {
      setTogglingLooks(prev => ({ ...prev, [modelId]: false }));
    }
  };

  if (!user) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6"
          >
            <div className="glass-panel-strong rounded-3xl p-8 max-w-lg w-full max-h-[80vh] overflow-hidden flex flex-col"
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl glass-card border border-white/20 flex items-center justify-center">
                    <Shield className="w-5 h-5 text-slate-300" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">NSFW Override</h2>
                    <p className="text-sm text-slate-400">{user.email}</p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="w-10 h-10 rounded-xl glass-card flex items-center justify-center"
                  data-testid="button-close-nsfw-modal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mb-4 space-y-3">
                <div className="p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
                  <p className="text-xs text-yellow-300">
                    Enable NSFW override for models uploaded by this user. This allows real photos to use NSFW features (use only with user consent).
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/20">
                  <p className="text-xs text-cyan-300">
                    <strong>Unlock model looks</strong>: when ON, the user can edit this model&apos;s photos and looks (e.g. to change reference photos). Turn OFF when they&apos;re done to lock again.
                  </p>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
                  </div>
                ) : models.length === 0 ? (
                  <div className="text-center py-8 text-gray-400">
                    <ImageIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>No models found for this user</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {models.map(model => (
                      <div 
                        key={model.id}
                        className="flex flex-col gap-3 p-4 rounded-xl bg-white/5 border border-white/10"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            {model.thumbnail ? (
                              <img 
                                src={model.thumbnail} 
                                alt={model.name}
                                className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
                              />
                            ) : (
                              <div className="w-12 h-12 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                                <ImageIcon className="w-6 h-6 text-gray-500" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="font-medium truncate">{model.name}</p>
                              <div className="flex items-center gap-2 mt-1 flex-wrap">
                                {model.isAIGenerated ? (
                                  <span className="px-2 py-0.5 rounded text-xs bg-blue-500/20 text-blue-400">
                                    AI Generated
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded text-xs bg-gray-500/20 text-gray-400">
                                    Real Upload
                                  </span>
                                )}
                                {model.loraStatus === 'ready' && (
                                  <span className="px-2 py-0.5 rounded text-xs bg-green-500/20 text-green-400">
                                    LoRA Ready
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 flex-shrink-0">
                            <button
                              onClick={() => !model.isAIGenerated && toggleNsfw(model.id, model.nsfwOverride)}
                              disabled={toggling[model.id] || model.isAIGenerated}
                              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition text-sm ${
                                model.isAIGenerated
                                  ? 'bg-blue-500/20 text-blue-400 cursor-not-allowed opacity-70'
                                  : model.nsfwOverride
                                    ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                                    : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                              }`}
                              title={model.isAIGenerated ? 'AI models have NSFW enabled by default' : 'Toggle NSFW override'}
                              data-testid={`button-toggle-nsfw-${model.id}`}
                            >
                              {toggling[model.id] ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : model.isAIGenerated ? (
                                <><ShieldCheck className="w-3.5 h-3.5" /> NSFW</>
                              ) : model.nsfwOverride ? (
                                <><ShieldCheck className="w-3.5 h-3.5" /> ON</>
                              ) : (
                                <><ShieldX className="w-3.5 h-3.5" /> OFF</>
                              )}
                            </button>
                            <button
                              onClick={() => toggleLooksUnlock(model.id, model.looksUnlockedByAdmin)}
                              disabled={togglingLooks[model.id]}
                              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition text-sm ${
                                model.looksUnlockedByAdmin
                                  ? 'bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30'
                                  : 'bg-slate-500/20 text-slate-400 hover:bg-slate-500/30'
                              }`}
                              title={model.looksUnlockedByAdmin ? 'User can edit photos/looks — click to lock' : 'Unlock so user can edit photos/looks'}
                              data-testid={`button-toggle-looks-${model.id}`}
                            >
                              {togglingLooks[model.id] ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : model.looksUnlockedByAdmin ? (
                                <><LockOpen className="w-3.5 h-3.5" /> Unlocked</>
                              ) : (
                                <><Lock className="w-3.5 h-3.5" /> Locked</>
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
