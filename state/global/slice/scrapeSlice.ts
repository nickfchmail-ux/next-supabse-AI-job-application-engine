import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export type ScrapePhase = "idle" | "starting" | "polling" | "done" | "error";

interface ScrapeState {
  phase: ScrapePhase;
  jobId: string | null;
  logs: string[];
  errorMsg: string;
}

const initialState: ScrapeState = {
  phase: "idle",
  jobId: null,
  logs: [],
  errorMsg: "",
};

const scrapeSlice = createSlice({
  name: "scrape",
  initialState,
  reducers: {
    scrapeStarted(state) {
      state.phase = "starting";
      state.logs = [];
      state.errorMsg = "";
      state.jobId = null;
    },
    scrapePolling(state, action: PayloadAction<string>) {
      state.phase = "polling";
      state.jobId = action.payload;
    },
    scrapeLogsUpdated(state, action: PayloadAction<string[]>) {
      state.logs = action.payload;
    },
    scrapeDone(state) {
      state.phase = "done";
    },
    scrapeError(state, action: PayloadAction<string>) {
      state.phase = "error";
      state.errorMsg = action.payload;
    },
    scrapeReset(state) {
      state.phase = "idle";
      state.jobId = null;
      state.logs = [];
      state.errorMsg = "";
    },
  },
});

export const {
  scrapeStarted,
  scrapePolling,
  scrapeLogsUpdated,
  scrapeDone,
  scrapeError,
  scrapeReset,
} = scrapeSlice.actions;

export default scrapeSlice.reducer;
