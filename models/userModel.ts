import { User as UserType } from "@/types/user";
import mongoose, { Model, Schema } from "mongoose";

const userSchema = new Schema<UserType>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    confirmedPassword: { type: String },
    passwordChangedOn: Date,
    resetPasswordToken: String,
    resetPasswordTokenExpiresAfter: Date,
  },
  { timestamps: true },
);

const User: Model<UserType> =
  mongoose.models.User || mongoose.model<UserType>("User", userSchema);

export default User;
