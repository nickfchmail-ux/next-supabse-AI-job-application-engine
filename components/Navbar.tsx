"use client";
import { logoutAction } from "@/app/actions/auth";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import AssignmentIndIcon from "@mui/icons-material/AssignmentInd";
import CloseIcon from "@mui/icons-material/Close";
import GppBadOutlinedIcon from "@mui/icons-material/GppBadOutlined";
import MenuIcon from "@mui/icons-material/Menu";
import SentimentSatisfiedAltIcon from "@mui/icons-material/SentimentSatisfiedAlt";
import SickOutlinedIcon from "@mui/icons-material/SickOutlined";
import SpaceDashboardIcon from "@mui/icons-material/SpaceDashboard";
import Badge from "@mui/material/Badge";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import BackButton from "./BackButton";
import TransparentButton from "./TransparentButton";
type Props = {
  currentPath?: string;
  fit?: number;
  notFit?: number;
};

export default function Navbar({ currentPath = "/", fit, notFit }: Props) {
  const links = [
    { href: "/", label: "Dashboard" },
    { href: "/fit", label: "Good Fit" },
    { href: "/not-fit", label: "Not Fit" },
    { href: "/not-interested", label: "Not Interested" },
    { href: "/profile", label: "Profile" },
  ];

  const pathName = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);

  function getLinkIcon(label: string) {
    switch (label) {
      case "Good Fit":
        return (
          <Badge badgeContent={fit} color="primary">
            <SentimentSatisfiedAltIcon color="primary" />
          </Badge>
        );
      case "Not Fit":
        return <GppBadOutlinedIcon color="error" />;
      case "Dashboard":
        return <SpaceDashboardIcon color="secondary" />;
      case "Not Interested":
        return <SickOutlinedIcon color="warning" />;
      default:
        return <AssignmentIndIcon color="info" />;
    }
  }

  function buildNavLinks(noBorder = false) {
    return links.map((link) => {
      const isActive = pathName === link.href;
      const shouldShowBadge =
        link.label === "Good Fit" || link.label === "Not Fit";
      return (
        <TransparentButton
          key={link.label}
          icon={getLinkIcon(link.label)}
          isActive={isActive}
          iconPosition={shouldShowBadge ? "right" : "left"}
          title={link.label}
          noBorder={noBorder}
          onClick={() => {
            router.push(link.href);
            setDrawerOpen(false);
          }}
        />
      );
    });
  }

  const signOutButton = (
    <form action={logoutAction}>
      <button
        type="submit"
        className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-red-500 dark:hover:text-red-400 transition-colors px-2 py-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950"
      >
        <svg
          className="w-3.5 h-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
          />
        </svg>
        Sign out
      </button>
    </form>
  );

  return (
    <nav className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-4 sm:px-8 flex items-center justify-between gap-4 py-5">
        {/* Brand / Back */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <div className="mt-2 ml-2 w-min-[max-content]">
            <BackButton />
          </div>
        </Link>

        {/* Desktop nav links */}
        <div className="hidden md:flex items-center gap-1 flex-wrap justify-around">
          {buildNavLinks()}
        </div>

        {/* Desktop sign out */}
        <div className="hidden md:block">{signOutButton}</div>

        {/* Mobile hamburger */}
        <IconButton
          className="md:hidden!"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation menu"
          sx={{ color: "var(--color-zinc-600)" }}
        >
          <MenuIcon />
        </IconButton>
      </div>

      {/* Mobile drawer */}
      <Drawer
        anchor="top"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        PaperProps={{
          sx: {
            bgcolor: "var(--color-zinc-900, #fff)",
            borderBottom: "1px solid var(--color-zinc-800, #e4e4e7)",
          },
        }}
      >
        <div className="px-4 py-4 space-y-2 bg-white dark:bg-zinc-900">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              Navigation
            </span>
            <IconButton
              onClick={() => setDrawerOpen(false)}
              size="small"
              aria-label="Close navigation menu"
              sx={{ color: "var(--color-zinc-500)" }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </div>
          <div className="flex flex-col gap-1">{buildNavLinks(true)}</div>
          <div className="border-t border-zinc-200 dark:border-zinc-800 pt-2 mt-2">
            {signOutButton}
          </div>
        </div>
      </Drawer>
    </nav>
  );
}
