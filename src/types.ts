export type JobKeywordInsightCategory =
  | "skill"
  | "technology"
  | "certification"
  | "attribute";

export interface JobKeywordInsight {
  job_id: string;
  keyword: string;
  category: JobKeywordInsightCategory;
  analyzed_at: string;
  archetype: string;
  provider: string | null;
}

export interface KeywordInsight {
  keyword: string;
  category: string;
  archetype?: string;
  count: number;
  last_updated?: string | null;
  /** 2021 Census denominator; null when no geography matches. */
  population_2021?: number | null;
  /** Jobs per 100k residents; null without a denominator. */
  per_100k?: number | null;
}

export interface ListingInstance {
  job_id: string;
  location?: string | null;
  scraped_at: string;
  posted_at: string | null;
  posted_relative_text: string | null;
  applicant_count: number | null;
  salary_text: string | null;
  recruiter_name: string | null;
  recruiter_profile_url: string | null;
  recruiter_identifier: string | null;
  normalized_location?: string | null;
  posting_wave_key?: string | null;
  posting_wave_index?: number | null;
  variant_type?: "original" | "simultaneous_variant" | "location_variant" | "repost" | null;
  location_source?: "source_snapshot" | "canonical_anchor" | "linkedin_rescrape" | null;
  location_observed_at?: string | null;
  scrape_run_id?: string | null;
  last_seen_at?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  salary_currency?: string | null;
  salary_metadata_source?: string | null;
}

export interface Job {
  job_id: string;
  company: string | null;
  job_title: string | null;
  level: string | null;
  location: string | null;
  location_province_code?: string | null;
  location_scope?: string | null;
  location_metro?: string | null;
  listing_location_province_codes?: string[] | null;
  listing_location_scopes?: string[] | null;
  description: string | null;
  status: string | null;
  is_active: boolean | null;
  application_date: string | null;
  resume_score: number | null;
  notes: string | null;
  scraped_at: string | null;
  last_checked: string | null;
  job_state: string | null;
  resume_score_stage: string | null;
  is_interested: boolean | null;
  customized_resume_id: string | null;
  customized_resumes?: Pick<Resume, "resume_link"> | null;
  resume_link?: string | null;
  provider: string | null;
  posted_at: string | null;
  last_seen_posted_at: string | null;
  effective_posted_at?: string | null;
  posted_relative_text: string | null;
  applicant_count: number | null;
  salary_text: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  recruiter_name: string | null;
  recruiter_profile_url: string | null;
  recruiter_identifier: string | null;
  original_job_id: string | null;
  latest_job_id: string | null;
  canonical_key: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  seen_count: number | null;
  posting_wave_count?: number | null;
  repost_count: number | null;
  search_query: string | null;
  archetype: string | null;
  filter_profile: string | null;
  is_filtered: boolean | null;
  filter_reason: string | null;
  is_entry_level_filtered: boolean | null;
  description_fingerprint: string | null;
  insights_analyzed_at: string | null;
  insights_reanalyzed_at: string | null;
  listing_instances: ListingInstance[] | null;
}

/** Narrow row used by paginated job lists. Large detail fields are fetched
 * only for the selected job. */
export type JobListItem = Pick<
  Job,
  | "job_id"
  | "company"
  | "job_title"
  | "level"
  | "location"
  | "status"
  | "is_active"
  | "job_state"
  | "application_date"
  | "resume_score"
  | "resume_score_stage"
  | "is_interested"
  | "customized_resume_id"
  | "customized_resumes"
  | "resume_link"
  | "provider"
  | "posted_at"
  | "last_seen_posted_at"
  | "effective_posted_at"
  | "posted_relative_text"
  | "applicant_count"
  | "salary_text"
  | "salary_min"
  | "salary_max"
  | "salary_currency"
  | "scraped_at"
  | "latest_job_id"
  | "repost_count"
  | "archetype"
  | "is_filtered"
  | "filter_reason"
>;

// --- Resume Related Interfaces ---

export interface Education {
  degree: string;
  field_of_study: string | null;
  institution: string;
  start_year: string | null;
  end_year: string | null;
}

export interface Experience {
  job_title: string;
  company: string;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  description: string | null;
}

export interface Project {
  name: string;
  description: string | null;
  technologies: string[] | null;
}

export interface Certification {
  name: string;
  issuer: string | null;
  year: string | null;
}

export interface Links {
  linkedin: string | null;
  github: string | null;
  portfolio: string | null;
}

// Updated Resume Interface
export interface Resume {
  id: string; // Assuming this is the primary key for the resume table
  name: string;
  email: string;
  created_at: string; // Keep this if it's the resume creation timestamp
  phone: string;
  location: string;
  summary: string;
  skills: string[]; 
  education: Education[];
  experience: Experience[];
  projects: Project[];
  certifications: Certification[];
  languages: string[];
  links: Links; // Changed to single object based on Python model
  parsed_at: string;
  last_updated?: string; // Optional field for last update timestamp
  resume_link?: string; // Optional field for resume link ur
}
