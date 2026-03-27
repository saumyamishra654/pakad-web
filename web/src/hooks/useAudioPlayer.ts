"use client";

import { useState, useRef, useCallback, useEffect } from "react";

export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentTimeRef = useRef(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activeStem, setActiveStem] = useState<string>("vocals");
  const [playbackRate, setPlaybackRate] = useState(1);

  useEffect(() => {
    const audio = new Audio();
    audio.addEventListener("loadedmetadata", () => setDuration(audio.duration));
    audio.addEventListener("ended", () => setIsPlaying(false));
    audioRef.current = audio;
    return () => { audio.pause(); audio.src = ""; };
  }, []);

  // 60fps RAF loop for currentTimeRef + 10Hz React state updates
  useEffect(() => {
    let rafId: number;
    let lastStateUpdate = 0;

    function tick() {
      const audio = audioRef.current;
      if (audio) {
        currentTimeRef.current = audio.currentTime;

        // Update React state at ~10Hz for UI (karaoke, time display)
        const now = performance.now();
        if (now - lastStateUpdate > 100) {
          setCurrentTime(audio.currentTime);
          lastStateUpdate = now;
        }
      }
      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const loadStem = useCallback((url: string, stem: string) => {
    const audio = audioRef.current;
    if (!audio) return;
    const wasPlaying = !audio.paused;
    const time = audio.currentTime;
    audio.src = url;
    audio.currentTime = time;
    audio.playbackRate = playbackRate;
    setActiveStem(stem);
    if (wasPlaying) audio.play();
  }, [playbackRate]);

  const play = useCallback(() => { audioRef.current?.play(); setIsPlaying(true); }, []);
  const pause = useCallback(() => { audioRef.current?.pause(); setIsPlaying(false); }, []);

  const seek = useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      currentTimeRef.current = time;
      setCurrentTime(time);
    }
  }, []);

  const skip = useCallback((seconds: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime + seconds);
    }
  }, []);

  const setSpeed = useCallback((rate: number) => {
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
    setPlaybackRate(rate);
  }, []);

  return {
    isPlaying, currentTime, currentTimeRef, duration,
    activeStem, playbackRate,
    loadStem, play, pause, seek, skip, setSpeed,
  };
}
