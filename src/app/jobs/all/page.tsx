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
import { getAllJobs, getAllJobsCount } from "@/lib/supabase/queries";

const DEFAULT_PAGE_SIZE = 25;
const SUPPORTED_FILTERS = ROUTE_FILTERS["/jobs/all"];
const SUPPORTED_SORTS = ROUTE_SORTS["/jobs/all"];

export default async function AllJobsPage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const filters = parseFilterSearchParams(
    sanitizeSearchParamsForRoute((await searchParams) ?? {}, "/jobs/all"),
  );
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;
  const currentPage = filters.page ?? 1;
  const options = { ...filters, page: currentPage, pageSize };
  const [jobs, totalCount] = await Promise.all([
    getAllJobs(options),
    getAllJobsCount(options),
  ]);
  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <div className="mx-auto flex h-full min-h-0 max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">All Jobs</h1>
          <p className="mt-1 text-sm text-gray-500">
            Every job, including expired listings ({totalCount} total)
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
          jobs={jobs}
          currentPage={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          listTitle="All Jobs"
        />
      </Suspense>
    </div>
  );
}

export const revalidate = 3600;
