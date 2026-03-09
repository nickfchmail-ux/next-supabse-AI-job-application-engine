import { Document } from "mongoose";

export interface User extends Document {
  name: string;
  email: string;
  password: string;
  confirmedPassword: string;
  resetPasswordToken?: string;
  resetPasswordTokenExpiresAfter: Date;
  passwordChangedOn: Date;
}
