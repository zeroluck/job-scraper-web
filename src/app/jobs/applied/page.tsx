import { Suspense } from "react";

import AppliedJobsList from "@/components/jobs/AppliedJobsList";
import FilterButton from "@/components/jobs/FilterButton";
import FilterChips from "@/components/jobs/FilterChips";
import JobListSkeleton from "@/components/jobs/JobListSkeleton";
import RefreshButton from "@/components/jobs/RefreshButton";
import SearchComponent from "@/components/jobs/SearchComponent";
import SortOptions from "@/components/jobs/SortOptions";
import { parseFilterSearchParams } from "@/lib/filters/searchParams";
import { ROUTE_FILTERS, ROUTE_SORTS, sanitizeSearchParamsForRoute } from "@/lib/filters/routeConfig";
import { getAppliedJobs, getAppliedJobsCount } from "@/lib/supabase/queries";

const DEFAULT_PAGE_SIZE = 25;
const SUPPORTED_FILTERS = ROUTE_FILTERS["/jobs/applied"];
const SUPPORTED_SORTS = ROUTE_SORTS["/jobs/applied"];

export default async function AppliedJobsPage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const filters = parseFilterSearchParams(
    sanitizeSearchParamsForRoute((await searchParams) ?? {}, "/jobs/applied"),
  );
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;
  const currentPage = filters.page ?? 1;
  const options = { ...filters, page: currentPage, pageSize };
  const [appliedJobs, totalCount] = await Promise.all([
    getAppliedJobs(options),
    getAppliedJobsCount(options),
  ]);
  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Applied Jobs</h1>
          <p className="mt-1 text-sm text-gray-500">
            Showing applied jobs ({totalCount} total)
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <Suspense fallback={null}>
            <SearchComponent />
            <FilterButton supportedFilters={SUPPORTED_FILTERS} />
            <SortOptions supportedSorts={SUPPORTED_SORTS} />
          </Suspense>
          <RefreshButton currentPage={currentPage} />
        </div>
      </div>

      <Suspense fallback={null}>
        <FilterChips supportedFilters={SUPPORTED_FILTERS} />
      </Suspense>
      <Suspense fallback={<JobListSkeleton />}>
        <AppliedJobsList
          jobs={appliedJobs}
          currentPage={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
        />
      </Suspense>
    </div>
  );
}

export const revalidate = 3600;
