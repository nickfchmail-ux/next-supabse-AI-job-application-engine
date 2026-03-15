import { getUserId } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";
import { paginateAndFilter } from "../_shared";

export async function GET(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("fit", true)
    .eq("user_id", userId)
    .neq("interested_in", false);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return paginateAndFilter(jobs ?? [], req);
}
