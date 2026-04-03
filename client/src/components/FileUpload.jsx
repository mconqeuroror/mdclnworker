import { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, Check, Image as ImageIcon, Video, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { uploadToCloudinary as uploadFile } from '../services/api';

// Supported formats — MP4 only for video; JPG/PNG only for images.
// Other formats should be converted first via the Content Reformatter.
const VIDEO_ACCEPT = { 'video/mp4': ['.mp4'] };
const IMAGE_ACCEPT = { 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'] };

export default function FileUpload({ type = 'image', onUpload, preview, large, acceptOnlyMp4 = false }) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const accept = type === 'image' ? IMAGE_ACCEPT : VIDEO_ACCEPT;

  const handleDrop = async (files) => {
    const file = files[0];
    if (!file) return;

    setUploading(true);
    setProgress(0);

    try {
      const url = await uploadFile(file, setProgress);
      onUpload({ url, file });
      toast.success('Upload complete!');
    } catch (error) {
      toast.error('Upload failed');
      console.error(error);
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  const handleDropRejected = (rejectedFiles) => {
    if (rejectedFiles?.length > 0) {
      toast.error(
        'File type not supported. Use the Content Reformatter to change the file format.',
        { duration: 5000, id: 'unsupported-file-type' }
      );
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: handleDrop,
    onDropRejected: handleDropRejected,
    accept,
    multiple: false
  });

  const Icon = type === 'image' ? ImageIcon : Video;

  return (
    <div
      {...getRootProps()}
      className={`
        relative cursor-pointer overflow-hidden rounded-xl transition-all duration-300 group
        ${large ? 'aspect-video' : 'h-24 sm:h-28'}
        ${isDragActive ? 'scale-[1.02]' : ''}
      `}
      style={{
        background: isDragActive 
          ? 'linear-gradient(135deg, rgba(139,92,246,0.14) 0%, rgba(59,130,246,0.08) 100%)'
          : 'rgba(20,20,30,0.5)',
        border: '1px solid rgba(255,255,255,0.1)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
      }}
    >
      {/* Border effect */}
      <div 
        className={`absolute inset-0 rounded-xl transition-all duration-300 ${
          isDragActive 
            ? 'border-2 border-purple-500/50' 
            : preview 
              ? 'border border-white/20' 
              : 'border-2 border-dashed border-white/20 group-hover:border-white/40'
        }`}
      />
      
      
      <input {...getInputProps()} />
      
      {uploading ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {/* Progress ring */}
          <div className="relative w-16 h-16 mb-3">
            <svg className="w-full h-full transform -rotate-90">
              <circle
                cx="32"
                cy="32"
                r="28"
                fill="none"
                stroke="rgba(255,255,255,0.1)"
                strokeWidth="4"
              />
              <circle
                cx="32"
                cy="32"
                r="28"
                fill="none"
                stroke="url(#progressGradient)"
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={`${progress * 1.76} 176`}
                className="transition-all duration-300"
              />
              <defs>
                <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#8B5CF6" />
                  <stop offset="100%" stopColor="#3B82F6" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-sm font-medium text-white">{progress}%</span>
            </div>
          </div>
          <span className="text-xs text-slate-400">Uploading...</span>
        </div>
      ) : preview ? (
        <>
          {type === 'image' ? (
            <img 
              src={preview.url} 
              alt="Preview" 
              className="w-full h-full object-contain bg-black/30 rounded-xl" 
            />
          ) : (
            <video 
              src={preview.url} 
              className="w-full h-full object-contain bg-black/30 rounded-xl"
              muted
              playsInline
              controls={false}
              autoPlay={false}
            />
          )}
          {/* Success badge */}
          <div className="absolute top-3 right-3 px-2.5 py-1 rounded-full text-[11px] font-medium flex items-center gap-1.5 shadow-lg"
            style={{
              background: 'linear-gradient(135deg, rgba(34,197,94,0.9) 0%, rgba(22,163,74,0.9) 100%)',
            }}
          >
            <Check className="w-3.5 h-3.5" />
            Ready
          </div>
          {/* Replace overlay on hover */}
          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center rounded-xl">
            <div className="text-center">
              <Upload className="w-6 h-6 mx-auto mb-2 text-white" />
              <span className="text-sm text-white">Replace</span>
            </div>
          </div>
        </>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center gap-3 p-3">
          <div className={`p-2.5 rounded-lg transition-all duration-300 ${
            isDragActive ? 'bg-white/10' : 'bg-white/5 group-hover:bg-white/8'
          }`}>
            <Icon className={`w-5 h-5 ${isDragActive ? 'text-white' : 'text-slate-400 group-hover:text-white'} transition-colors`} />
          </div>
          <div className="text-left">
            <span className={`text-sm font-medium block ${isDragActive ? 'text-white' : 'text-slate-300'}`}>
              {isDragActive ? 'Drop here' : 'Upload'}
            </span>
            <span className="text-[10px] text-slate-500">
              {type === 'image' ? 'JPG, PNG' : 'MP4 only'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
