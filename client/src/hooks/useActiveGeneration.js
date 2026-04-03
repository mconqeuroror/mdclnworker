import { useState, useRef, useCallback, useEffect } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';

export function useActiveGeneration() {
  const [activeGeneration, setActiveGeneration] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const pollIntervalRef = useRef(null);
  const mountedRef = useRef(true);
  const consecutivePollErrorsRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  const startGeneration = useCallback((placeholder) => {
    setIsGenerating(true);
    setActiveGeneration(placeholder);
  }, []);

  const pollForCompletion = useCallback((generationId, { onSuccess, onFailure } = {}) => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }
    
    console.log('🔄 Starting poll for generation:', generationId);
    consecutivePollErrorsRef.current = 0;

    // Immediately show a queued/submitted state while first status poll is in-flight.
    setActiveGeneration((prev) => ({
      ...(prev || {}),
      id: generationId,
      status: "pending",
      progressStage: "Queued successfully",
      createdAt: prev?.createdAt || new Date().toISOString(),
    }));

    // Unlock UI right after submit/poll start so users can queue another generation immediately.
    setIsGenerating(false);

    pollIntervalRef.current = setInterval(async () => {
      if (!mountedRef.current) {
        clearInterval(pollIntervalRef.current);
        return;
      }

      try {
        console.log('🔍 Polling generation:', generationId);
        const response = await api.get(`/generations/${generationId}`);
        console.log('📦 Poll response:', response.data);
        
        if (response.data.success && response.data.generation) {
          const gen = response.data.generation;
          console.log('📋 Generation status:', gen.status, 'outputUrl:', gen.outputUrl);
          
          // Always update state so UI reflects current status
          setActiveGeneration(gen);
          
          if (gen.status === 'completed') {
            console.log('✅ Generation completed! URL:', gen.outputUrl);
            clearInterval(pollIntervalRef.current);
            setIsGenerating(false);
            onSuccess?.(gen);
          } else if (gen.status === 'failed') {
            console.log('❌ Generation failed:', gen.errorMessage);
            clearInterval(pollIntervalRef.current);
            setIsGenerating(false);
            toast.error(gen.errorMessage || 'Generation failed — credits refunded');
            onFailure?.(gen);
          }
        }
        consecutivePollErrorsRef.current = 0;
      } catch (error) {
        console.error('Poll error:', error);
        consecutivePollErrorsRef.current += 1;
        if (consecutivePollErrorsRef.current >= 10) {
          clearInterval(pollIntervalRef.current);
          setIsGenerating(false);
          toast.error('Generation status check is unstable. Please refresh in a moment.');
          onFailure?.({ status: 'unknown', errorMessage: 'Polling failed repeatedly' });
        }
      }
    }, 3000);
  }, []);

  const setFailed = useCallback((errorMessage) => {
    setActiveGeneration(prev => prev ? { ...prev, status: 'failed', error: errorMessage } : null);
    setIsGenerating(false);
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }
  }, []);

  const reset = useCallback(() => {
    setActiveGeneration(null);
    setIsGenerating(false);
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }
  }, []);

  return {
    activeGeneration,
    isGenerating,
    startGeneration,
    pollForCompletion,
    setFailed,
    reset,
  };
}
