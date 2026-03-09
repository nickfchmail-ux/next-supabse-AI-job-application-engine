import mongoose, { Model } from "mongoose";

import { job as JobType } from "@/types/job";

const jobSchema = new mongoose.Schema<JobType>(
  {
    title: String,
    company: String,
    location: String,
    salary: String,
    posted_date: String,
    url: String,
    short_description: String,
    keyword: String,
    scraped_date: String,
    responsibilities: [String],
    requirements: [String],
    benefits: [String],
    skills: [String],
    employment_type: String,
    experience_level: String,
    about_company: String,
    raw_description: String,
    fit: Boolean,
    fit_score: Number,
    fit_reasons: [String],
    cover_letter: String,
    expected_salary: String,
    user_id: String,
    created_at: String,
    updated_at: String,
    search_key: String,
    applied: Boolean,
  },
  { timestamps: true },
);

const Job: Model<JobType> =
  mongoose.models.Job || mongoose.model<JobType>("Job", jobSchema);
