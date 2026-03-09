import jwt from "jsonwebtoken";
import { NextResponse } from "next/server";
export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");

    if (!authHeader?.startsWith("Bearer")) {
      throw new Error(
        "You have to provide authorization token to perform this action",
      );
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET!);
    console.log(decoded);
    return NextResponse.json({
      success: true,
      message: "you are authenticated",
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error ? error.message : "Unknow error happened",
      },
      { status: 401 },
    );
  }
}
