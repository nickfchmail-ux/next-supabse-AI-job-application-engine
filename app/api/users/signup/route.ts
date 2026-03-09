import { connectMongoDB } from "@/lib/mongoDB";
import bcrypt from "bcrypt";
import { NextResponse } from "next/server";

//import from handwritten module
import User from "@/models/userModel";
import { User as UserType } from "@/types/user";

export async function POST(req: Request) {
  await connectMongoDB();

  try {
    const requestPayload = (await req.json()) as UserType;

    const passValidation =
      requestPayload.name &&
      requestPayload.email &&
      requestPayload.password &&
      requestPayload.confirmedPassword;

    if (!passValidation) {
      throw new Error(
        "validation failed, please provide required fields to sign up your account",
      );
    }

    //validate passowrd === confirmed password
    if (requestPayload.password !== requestPayload.confirmedPassword) {
      throw new Error(
        "please check your password, you have to provide the same password and confirmed password",
      );
    }

    const hashedPassword = await bcrypt.hash(requestPayload.password, 10);

    const createdUser = await User.create({
      name: requestPayload.name,
      email: requestPayload.email,
      password: hashedPassword,
    });

    return NextResponse.json({ success: true, user: createdUser });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "An unknown error occurred",
      },
      { status: 400 },
    );
  }
}
