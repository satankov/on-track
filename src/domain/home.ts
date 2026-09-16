export interface HomeInfo {
  version: string | null;
  installation: "managed" | "manual";
}
export interface HomeRelease {
  version: string;
  url: string;
}
export interface HomeCheck {
  checkedAt: number;
  status:
    | "available"
    | "current"
    | "ahead"
    | "manual"
    | "incompatible"
    | "unverified"
    | "empty";
  releases: HomeRelease[];
  update?: {
    version: string;
    command: string;
    exactCommand?: string;
    kind: "managed" | "manual";
  };
}
