export type SongSource = "youtube" | "file";
export type SongVisibility = "public" | "private";
export type SongStatus = "processing" | "complete" | "failed";
export type SongType = "classical" | "semi-classical" | "filmy";
export type AnalysisType = "canonical" | "moderator" | "fork";

export interface Song {
  id: string;
  title: string;
  source: SongSource;
  youtubeVideoId: string | null;
  audioHash: string;
  uploadedBy: string;
  visibility: SongVisibility;
  status: SongStatus;
  processingStep?: string;
  songType: SongType | null;
  createdAt: Date;
  viewCount: number;
  commentCount: number;
}

export interface CandidateRaga {
  name: string;
  score: number;
  notesMatch: string;
  phrasesMatch: string;
}

export interface CharacteristicPhrase {
  pattern: string;
  found: boolean;
}

export interface AnalysisResults {
  detectedRaga: string;
  detectedTonic: string;
  confidence: number;
  candidateRagas: CandidateRaga[];
  aroha: string;
  avroh: string;
  distinguishingNotes: string;
  characteristicPhrases: CharacteristicPhrase[];
  timeOfDay: string;
}

export interface AnalysisParams {
  tonic: string | null;
  raga: string | null;
  instrument: string;
  vocalistGender: string | null;
  [key: string]: string | null;
}

export interface Analysis {
  id: string;
  songId: string;
  type: AnalysisType;
  ownerId: string;
  parentAnalysisId: string | null;
  params: AnalysisParams;
  results: AnalysisResults | null;
  artifactPaths: Record<string, string>;
  status: SongStatus;
  createdAt: Date;
}

export interface Comment {
  id: string;
  songId: string;
  authorId: string;
  authorName: string;
  text: string;
  timestampSeconds: number;
  parentCommentId: string | null;
  createdAt: Date;
}

export interface TranscriptionNote {
  sargam: string;
  octave: number;
  startTime: number;
  endTime: number;
  duration: number;
}

export interface TranscriptionPhrase {
  index: number;
  startTime: number;
  endTime: number;
  notes: string;
}

export interface TranscriptionEdit {
  id: string;
  ownerId: string;
  baseVersion: "system" | "moderator";
  notes: TranscriptionNote[];
  phrases: TranscriptionPhrase[];
  isDefault: boolean;
  createdAt: Date;
}

export interface JobStatus {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  step: string;
  songId: string;
  analysisId: string;
  error: string | null;
  createdAt: string;
}

export interface PitchPoint {
  time: number;
  frequency: number;
  midi: number;
  confidence: number;
}

export interface UserPreferences {
  viewMode: "grid" | "list";
}
