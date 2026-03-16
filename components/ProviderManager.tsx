"use client";

import { Provider } from "react-redux";

import { store } from "@/state/global/store";
import { PropsWithChildren } from "react";
type ProviderManagerProps = {};

export default function ProviderManager({
  children,
}: PropsWithChildren<ProviderManagerProps>) {
  return (
    <Provider store={store}>
      {children}
    </Provider>
  );
}
