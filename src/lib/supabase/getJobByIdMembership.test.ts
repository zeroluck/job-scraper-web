import assert from "node:assert/strict";
import test from "node:test";

import {
  __resetSupabaseClientFactoryForTests,
  __setSupabaseClientFactoryForTests,
  getJobById,
} from "./queries.ts";

function clientForDetails() {
  const rpcCalls: Array<[string, Record<string, unknown>]> = [];
  const row = {
    job_id: "job-1",
    company: "Acme",
    job_title: "Engineer",
    archetype: "technology_delivery",
    resume_score: 10,
    is_filtered: false,
  };
  const query: Record<string, (...args: unknown[]) => unknown> = {};
  for (const method of ["select", "eq"]) query[method] = () => query;
  query.single = async () => ({ data: row, error: null });
  return {
    rpcCalls,
    client: {
      from: () => query,
      rpc: async (name: string, params: Record<string, unknown>) => {
        rpcCalls.push([name, params]);
        return {
          data: [{
            job_id: "job-1",
            archetype: "network_infrastructure",
            resume_score: 88,
            resume_score_stage: "custom",
            is_filtered: false,
            filter_reason: null,
            customized_resume_id: "resume-network",
            resume_link: "network_infrastructure/job-1/resume-network.pdf",
          }],
          error: null,
        };
      },
    },
  };
}

test("details use the explicitly supplied list membership projection", async () => {
  const mock = clientForDetails();
  __setSupabaseClientFactoryForTests(async () => mock.client);
  try {
    const job = await getJobById("job-1", "network_infrastructure");
    assert.equal(job?.archetype, "network_infrastructure");
    assert.equal(job?.resume_score, 88);
    assert.deepEqual(mock.rpcCalls, [["get_job_membership_projection_v1", {
      p_job_ids: ["job-1"],
      p_archetypes: ["network_infrastructure"],
      p_kind: "all",
      p_filter_status: null,
      p_min_score: null,
      p_max_score: null,
    }]]);
  } finally {
    __resetSupabaseClientFactoryForTests();
  }
});

test("details resolve a membership from any requested archetype", async () => {
  const mock = clientForDetails();
  __setSupabaseClientFactoryForTests(async () => mock.client);
  try {
    const job = await getJobById("job-1", [
      "technology_delivery",
      "network_infrastructure",
    ]);
    assert.equal(job?.archetype, "network_infrastructure");
    assert.deepEqual(mock.rpcCalls, [["get_job_membership_projection_v1", {
      p_job_ids: ["job-1"],
      p_archetypes: [
        "technology_delivery",
        "software_tpm",
        "network_infrastructure",
      ],
      p_kind: "all",
      p_filter_status: null,
      p_min_score: null,
      p_max_score: null,
    }]]);
  } finally {
    __resetSupabaseClientFactoryForTests();
  }
});

test("details do not guess membership without an archetype parameter", async () => {
  const mock = clientForDetails();
  __setSupabaseClientFactoryForTests(async () => mock.client);
  try {
    const job = await getJobById("job-1");
    assert.equal(job?.archetype, "technology_delivery");
    assert.equal(job?.resume_score, 10);
    assert.deepEqual(mock.rpcCalls, []);
  } finally {
    __resetSupabaseClientFactoryForTests();
  }
});
