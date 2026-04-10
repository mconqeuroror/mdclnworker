import { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, Check, Image as ImageIcon, Video, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { uploadToCloudinary as uploadFile } from '../services/api';

// Upload target formats (after optional auto-conversion).
const VIDEO_ACCEPT = { 'video/mp4': ['.mp4'], 'video/quicktime': ['.mov'] };
const IMAGE_ACCEPT = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/heic': ['.heic'],
  'image/heif': ['.heif'],
};

const SUPPORTED_IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png']);
const SUPPORTED_VIDEO_EXTS = new Set(['mp4']);

function getFileExt(file) {
  const name = String(file?.name || '');
  const ext = name.includes('.') ? name.split('.').pop() : '';
  return String(ext || '').toLowerCase();
}

function isSupportedOutputFormat(file, type) {
  const ext = getFileExt(file);
  const mime = String(file?.type || '').toLowerCase();
  if (type === 'image') {
    return mime === 'image/jpeg' || mime === 'image/png' || SUPPORTED_IMAGE_EXTS.has(ext);
  }
  return mime === 'video/mp4' || SUPPORTED_VIDEO_EXTS.has(ext);
}

function shouldAutoConvert(file, type) {
  if (isSupportedOutputFormat(file, type)) return false;
  const ext = getFileExt(file);
  const mime = String(file?.type || '').toLowerCase();
  if (type === 'image') {
    return ext === 'heic' || ext === 'heif' || mime.includes('heic') || mime.includes('heif');
  }
  return ext === 'mov' || mime === 'video/quicktime';
}

function buildConvertedFileName(file, type) {
  const original = String(file?.name || (type === 'image' ? 'upload.heic' : 'upload.mov'));
  const base = original.replace(/\.[^.]+$/, '') || 'upload';
  return type === 'image' ? `${base}.jpg` : `${base}.mp4`;
}

async function autoConvertToSupported(file, type, onProgress) {
  const { runReformatInBrowser } = await import('../utils/repurposeFfmpegWasm.js');
  const targetKind = type === 'image' ? 'image' : 'video';
  const convertedBlob = await runReformatInBrowser(file, targetKind, (percent) => {
    if (typeof percent === 'number') onProgress?.(Math.max(5, Math.min(90, Math.round(percent))));
  });
  const convertedType = type === 'image' ? 'image/jpeg' : 'video/mp4';
  return new File([convertedBlob], buildConvertedFileName(file, type), {
    type: convertedType,
    lastModified: Date.now(),
  });
}

export default function FileUpload({ type = 'image', onUpload, preview, large, acceptOnlyMp4 = false }) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const accept = type === 'image' ? IMAGE_ACCEPT : VIDEO_ACCEPT;

  const handleDrop = async (files) => {
    const initialFile = files[0];
    if (!initialFile) return;

    setUploading(true);
    setProgress(0);

    try {
      let uploadCandidate = initialFile;

      if (shouldAutoConvert(initialFile, type)) {
        const convertTargetLabel = type === 'image' ? 'JPEG' : 'MP4';
        const ext = getFileExt(initialFile).toUpperCase() || (type === 'image' ? 'HEIC' : 'MOV');
        toast.loading(`Converting ${ext} to ${convertTargetLabel}…`, { id: 'auto-convert-upload' });
        setProgress(5);
        try {
          uploadCandidate = await autoConvertToSupported(initialFile, type, setProgress);
          toast.success(`Converted to ${convertTargetLabel}. Uploading…`, { id: 'auto-convert-upload' });
        } catch (conversionError) {
          toast.error(`Could not convert this ${type}. Please use a ${convertTargetLabel} file.`, { id: 'auto-convert-upload' });
          throw Object.assign(new Error('AUTO_CONVERT_FAILED'), { isAutoConvertFailed: true, cause: conversionError });
        }
      }

      const url = await uploadFile(uploadCandidate, setProgress);
      onUpload({
        url,
        file: uploadCandidate,
        converted: uploadCandidate !== initialFile,
        originalFile: uploadCandidate !== initialFile ? initialFile : null,
      });
      toast.success('Upload complete!');
    } catch (error) {
      if (!error?.isAutoConvertFailed) {
        const msg =
          error?.message ||
          error?.response?.data?.message ||
          error?.response?.data?.error ||
          'Upload failed';
        toast.error(msg, { duration: 8000 });
      }
      console.error(error);
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  const handleDropRejected = (rejectedFiles) => {
    if (rejectedFiles?.length > 0) {
      toast.error(
        'File type not supported. MOV/HEIC are auto-converted; use MP4, JPG, or PNG for best results.',
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
        file-upload-dropzone
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
          <div className="fileupload-replace-overlay absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center rounded-xl">
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
              {type === 'image' ? 'JPG, PNG (HEIC auto-converts)' : 'MP4 (MOV auto-converts)'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
