import { configureStore } from "@reduxjs/toolkit";
import jobReducer from "./slice/jobSlice";
import scrapeReducer from "./slice/scrapeSlice";

export const store = configureStore({
  reducer: {
    jobs: jobReducer,
    scrape: scrapeReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;

export type AppDispatch = typeof store.dispatch;
