import { Suspense } from "react";

import FilterButton from "@/components/jobs/FilterButton";
import FilterChips from "@/components/jobs/FilterChips";
import JobListSkeleton from "@/components/jobs/JobListSkeleton";
import RefreshButton from "@/components/jobs/RefreshButton";
import SearchComponent from "@/components/jobs/SearchComponent";
import SortOptions from "@/components/jobs/SortOptions";
import TopMatchesList from "@/components/jobs/TopMatchesList";
import { parseFilterSearchParams } from "@/lib/filters/searchParams";
import { ROUTE_FILTERS, ROUTE_SORTS, sanitizeSearchParamsForRoute } from "@/lib/filters/routeConfig";
import { getAllActiveJobsCount, getNewJobs } from "@/lib/supabase/queries";

const DEFAULT_PAGE_SIZE = 25;
const SUPPORTED_FILTERS = ROUTE_FILTERS["/jobs/new"];
const SUPPORTED_SORTS = ROUTE_SORTS["/jobs/new"];

export default async function NewJobsPage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const filters = parseFilterSearchParams(
    sanitizeSearchParamsForRoute((await searchParams) ?? {}, "/jobs/new"),
  );
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;
  const currentPage = filters.page ?? 1;
  const options = { ...filters, page: currentPage, pageSize };
  const [newJobs, totalCount] = await Promise.all([
    getNewJobs(options),
    getAllActiveJobsCount(options),
  ]);
  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <div className="mx-auto flex h-full min-h-0 max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">New Jobs</h1>
          <p className="mt-1 text-sm text-gray-500">
            New jobs ({totalCount} total)
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
        <TopMatchesList
          jobs={newJobs}
          currentPage={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
        />
      </Suspense>
    </div>
  );
}

export const revalidate = 3600;
