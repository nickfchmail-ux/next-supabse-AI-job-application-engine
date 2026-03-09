import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { NextResponse } from "next/server";
//import from handwritten module
import { connectMongoDB } from "@/lib/mongoDB";
import User from "@/models/userModel";

export async function POST(req: Request) {
  await connectMongoDB();

  const payload = await req.json();

  console.log(payload);

  const user = await User.findOne({ email: payload.email });

  if (user) {
    const passPasswordVerification = await bcrypt.compare(
      payload?.password,
      user.password,
    );

    if (passPasswordVerification) {
      const accessToken = jwt.sign(
        { userId: user._id, email: user.email },
        process.env.JWT_SECRET!,
        { expiresIn: "1m" },
      );
      return NextResponse.json({ success: true, accessToken }, { status: 200 });
    }
  }

  console.log("found user: ", user);

  return NextResponse.json(
    { success: false, message: "failed to login" },
    { status: 401 },
  );
}
