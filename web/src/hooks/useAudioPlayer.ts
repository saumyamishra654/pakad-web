"use client";

import { useState, useRef, useCallback, useEffect } from "react";

export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activeStem, setActiveStem] = useState<string>("vocals");

  useEffect(() => {
    const audio = new Audio();
    audio.addEventListener("timeupdate", () => setCurrentTime(audio.currentTime));
    audio.addEventListener("loadedmetadata", () => setDuration(audio.duration));
    audio.addEventListener("ended", () => setIsPlaying(false));
    audioRef.current = audio;
    return () => { audio.pause(); audio.src = ""; };
  }, []);

  const loadStem = useCallback((url: string, stem: string) => {
    const audio = audioRef.current;
    if (!audio) return;
    const wasPlaying = !audio.paused;
    const time = audio.currentTime;
    audio.src = url;
    audio.currentTime = time;
    setActiveStem(stem);
    if (wasPlaying) audio.play();
  }, []);

  const play = useCallback(() => { audioRef.current?.play(); setIsPlaying(true); }, []);
  const pause = useCallback(() => { audioRef.current?.pause(); setIsPlaying(false); }, []);
  const seek = useCallback((time: number) => { if (audioRef.current) { audioRef.current.currentTime = time; setCurrentTime(time); } }, []);
  const skip = useCallback((seconds: number) => { if (audioRef.current) { audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime + seconds); } }, []);

  return { isPlaying, currentTime, duration, activeStem, loadStem, play, pause, seek, skip };
}
