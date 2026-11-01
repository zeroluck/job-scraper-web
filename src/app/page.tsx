// Stateless data clients do not make the route dynamic through cookies.
export const dynamic = "force-dynamic";

import Link from "next/link";
import {
  getAllActiveJobsCount,
  getAllJobsCount,
  getAppliedJobsCount,
  getTopScoredJobsCount,
  getExpiredJobsCount,
  getPendingScoreJobsCount,
  getScoredJobsCount,
  getCustomResumeJobsCount,
  getNoCustomResumeJobsCount,
  getScoredWithOriginalResumeCount,
  getScoredWithCustomResumeCount,
  getLinkedInJobsCount,
  getCareersFutureJobsCount,
  getAppliedJobsCountByDate, // Added import
} from "@/lib/supabase/queries";
import {
  Briefcase,
  CheckSquare,
  Star,
  Zap,
  Archive,
  FileClock,
  FileCheck,
  FileText,
  FileX,
  FileUp,
  FileSignature,
  Linkedin,
  SquareKanban,
  CalendarCheck, // Added import for a new icon
} from "lucide-react";

interface StatCardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  href: string;
  description: string;
  color: string;
}

function StatCard({
  title,
  value,
  icon,
  href,
  description,
  color,
}: StatCardProps) {
  return (
    <Link href={href} className="group transition-all duration-300 ease-in-out">
      <div className="bg-white h-full rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md hover:border-gray-200 transition-all duration-300">
        <div className={`h-1 ${color}`}></div>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div
              className={`${color.replace(
                "bg-",
                "text-"
              )} bg-opacity-10 p-2.5 rounded-lg`}
            >
              {icon}
            </div>
            <span className="text-4xl font-bold text-gray-800">{value}</span>
          </div>
          <div>
            <h3 className="text-sm font-medium text-gray-900 mb-1">{title}</h3>
            <p className="text-xs text-gray-500 line-clamp-2">{description}</p>
          </div>
        </div>
      </div>
    </Link>
  );
}

export default async function Home() {
  const totalNewJobs = await getAllActiveJobsCount();
  const totalJobs = await getAllJobsCount();
  const totalAppliedJobs = await getAppliedJobsCount();
  const totalTopMatches = await getTopScoredJobsCount();
  const expiredJobsCount = await getExpiredJobsCount();
  const pendingScoreJobsCount = await getPendingScoreJobsCount();
  const scoredJobsCount = await getScoredJobsCount();
  const customResumeJobsCount = await getCustomResumeJobsCount();
  const noCustomResumeJobsCount = await getNoCustomResumeJobsCount();
  const scoredWithOriginalResumeCount =
    await getScoredWithOriginalResumeCount();
  const scoredWithCustomResumeCount = await getScoredWithCustomResumeCount();
  const linkedInJobsCount = await getLinkedInJobsCount();
  const careersFutureJobsCount = await getCareersFutureJobsCount();

  // Get server's current local date in YYYY-MM-DD format
  const now = new Date(); // Current date/time in server's local timezone
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, "0"); // getMonth() is 0-indexed
  const day = now.getDate().toString().padStart(2, "0");
  const localToday = `${year}-${month}-${day}`; // e.g., "2025-05-21"

  console.log("Server's Local Date for Query:", localToday);
  // Pass the server's local date to the query function
  const appliedTodayCount = await getAppliedJobsCountByDate(localToday);

  // Create a Date object from the localToday string for formatting the description.
  // new Date(localToday) will parse it as midnight in the server's local timezone.
  const dateForAppliedTodayDescription = new Date(localToday);

  const stats = [
    {
      title: "New Jobs",
      value: totalNewJobs,
      icon: <Zap size={20} />,
      href: "/jobs/new",
      description: "Recently scraped job opportunities.",
      color: "bg-indigo-500",
    },
    {
      title: "All Jobs",
      value: totalJobs,
      icon: <Briefcase size={20} />,
      href: "/jobs/all",
      description: "Every job listing, including expired jobs.",
      color: "bg-slate-600",
    },
    {
      title: "Applied Jobs (Total)", // Clarified title
      value: totalAppliedJobs,
      icon: <CheckSquare size={20} />,
      href: "/jobs/applied",
      description: "Total jobs you have applied to.",
      color: "bg-green-500",
    },
    {
      title: "Applied Today", // New StatCard for jobs applied today
      value: appliedTodayCount,
      icon: <CalendarCheck size={20} />,
      href: "/jobs/applied", // Or link to a filtered view if available
      description: `Jobs applied on ${dateForAppliedTodayDescription.toLocaleDateString(
        "en-US",
        {
          month: "long",
          day: "numeric",
          year: "numeric",
          // No timeZone option, so it uses the server's local timezone for formatting
        }
      )}.`,
      color: "bg-pink-500", // Using a new color for distinction
    },
    {
      title: "Top Matches",
      value: totalTopMatches,
      icon: <Star size={20} />,
      href: "/jobs/top-matches",
      description: "Jobs that best match your profile.",
      color: "bg-amber-500",
    },
    {
      title: "Expired Jobs",
      value: expiredJobsCount,
      icon: <Archive size={20} />,
      href: "/",
      description: "Jobs that are no longer active.",
      color: "bg-gray-500",
    },
    {
      title: "Pending Scoring",
      value: pendingScoreJobsCount,
      icon: <FileClock size={20} />,
      href: "/jobs/new",
      description: "Active new jobs awaiting resume score.",
      color: "bg-sky-500",
    },
    {
      title: "Scored Jobs",
      value: scoredJobsCount,
      icon: <FileCheck size={20} />,
      href: "/jobs/top-matches",
      description: "Active new jobs that have a resume score.",
      color: "bg-violet-500",
    },
    {
      title: "Scored (Original)",
      value: scoredWithOriginalResumeCount,
      icon: <FileUp size={20} />,
      href: "/jobs/top-matches",
      description: "Jobs scored using the original resume.",
      color: "bg-blue-500",
    },
    {
      title: "Scored (Custom)",
      value: scoredWithCustomResumeCount,
      icon: <FileSignature size={20} />,
      href: "/jobs/top-matches",
      description: "Jobs scored using a customized resume.",
      color: "bg-purple-500",
    },
    {
      title: "Custom Resumes",
      value: customResumeJobsCount,
      icon: <FileText size={20} />,
      href: "/",
      description: "Jobs with a generated custom resume.",
      color: "bg-emerald-500",
    },
    {
      title: "No Custom Resumes",
      value: noCustomResumeJobsCount,
      icon: <FileX size={20} />,
      href: "/jobs/new",
      description: "Active jobs without a custom resume.",
      color: "bg-rose-500",
    },
    {
      title: "LinkedIn Jobs",
      value: linkedInJobsCount,
      icon: <Linkedin size={20} />,
      href: "/jobs/new",
      description: "Active LinkedIn jobs.",
      color: "bg-cyan-500",
    },
    {
      title: "CareersFuture Jobs",
      value: careersFutureJobsCount,
      icon: <SquareKanban size={20} />,
      href: "/jobs/new",
      description: "Active Careers Future jobs.",
      color: "bg-teal-500",
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {stats.map((stat) => (
            <StatCard
              key={stat.title}
              title={stat.title}
              value={stat.value}
              icon={stat.icon}
              href={stat.href}
              description={stat.description}
              color={stat.color}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
