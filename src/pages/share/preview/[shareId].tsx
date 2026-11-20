import { sitePreviewPath } from "@/types/library";
import LibraryConnectors from "@/components/agent-workspace/LibraryConnectors";
import { getMongoDb } from "@server/db/mongo";
import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import type { GetServerSideProps } from "next";
import { Box, Button, Flex } from "@chakra-ui/react";

import { getAuthUserFromRequest } from "@server/auth/ssr";
import { canViewRestrictedSite, getSiteSettings } from "@server/library/sites";
import { getProject } from "@server/projects/projectStorage";
import { recordSiteVisit } from "@server/shares/siteVisits";
import { getShareLink } from "@server/shares/shareStorage";
import { ensureStaticSiteBuilt } from "@server/shares/staticSiteBuilder";

type SharePreviewPageProps = {
  previewPath: string;
  shareId: string;
  siteName: string;
  updatedAt: string;
  driveEnabled: boolean;
  signedIn: boolean;
  connectorStatus: string | null;
};

type SharePayload = {
  mode: "editable" | "preview";
  project: {
    name: string;
    updatedAt: string;
  };
};

const SharePreviewPage = ({
  shareId,
  previewPath,
  siteName: initialSiteName,
  updatedAt: initialUpdatedAt,
  driveEnabled,
  signedIn,
  connectorStatus,
}: SharePreviewPageProps) => {
  const router = useRouter();
  const [connectionsOpen, setConnectionsOpen] = useState(Boolean(connectorStatus));
  const [authorizationResult, setAuthorizationResult] = useState(connectorStatus);
  const [siteName, setSiteName] = useState(initialSiteName);
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [unavailable, setUnavailable] = useState("");

  function closeConnections() {
    setConnectionsOpen(false);
    setAuthorizationResult(null);
    if (router.query.libraryConnectors !== undefined) {
      const query = { ...router.query };
      delete query.libraryConnectors;
      void router.replace({ pathname: router.pathname, query, hash: window.location.hash }, undefined, {
        shallow: true,
        scroll: false,
      });
    }
  }

  useEffect(() => {
    if (unavailable) return;
    const controller = new AbortController();
    let loading = false;
    const timer = window.setInterval(async () => {
      if (loading) return;
      loading = true;
      try {
        const response = await fetch(`/api/share/${encodeURIComponent(shareId)}`, { signal: controller.signal });
        if (response.status === 401) {
          window.location.replace("/login?lastRoute=" + encodeURIComponent(previewPath));
          return;
        }
        if (response.status === 403 || response.status === 404) {
          setUnavailable(response.status === 403 ? "当前账号已无权查看此站点。" : "此站点的分享链接已失效。");
          return;
        }
        if (!response.ok) return;
        const payload = (await response.json()) as SharePayload;
        if (payload.mode !== "preview") return;
        if (payload.project.updatedAt !== updatedAt) {
          setUpdatedAt(payload.project.updatedAt);
        }
        if (payload.project.name && payload.project.name !== siteName) {
          setSiteName(payload.project.name);
        }
      } catch {
        // Keep the current site visible during a temporary network outage.
      } finally {
        loading = false;
      }
    }, 5000);

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [shareId, previewPath, updatedAt, siteName, unavailable]);

  if (unavailable) {
    return (
      <Flex as="main" minH="100vh" align="center" justify="center">
        <Head>
          <title>站点无法访问</title>
        </Head>
        <Box role="alert">{unavailable}</Box>
      </Flex>
    );
  }

  const iframeSrc = `/api/sites/${encodeURIComponent(shareId)}/index.html?v=${encodeURIComponent(updatedAt)}`;

  return (
    <Flex direction="column" h="100vh" bg="white" overflow="hidden">
      <Head>
        <title>{siteName}</title>
      </Head>
      {driveEnabled && (
        <Flex justify="end" px={3} py={1} bg="gray.50" borderBottom="1px solid" borderColor="gray.100">
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              signedIn
                ? setConnectionsOpen(true)
                : window.location.assign("/login?lastRoute=" + encodeURIComponent(previewPath))
            }
          >
            连接我的 Google Drive
          </Button>
        </Flex>
      )}
      {driveEnabled && signedIn && connectionsOpen && (
        <LibraryConnectors
          siteId={shareId}
          callbackStatus={authorizationResult || undefined}
          close={closeConnections}
        />
      )}
      <Box flex="1" minH="0" position="relative">
        <Box
          as="iframe"
          key={updatedAt}
          src={iframeSrc}
          title={siteName}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
          display="block"
          border={0}
          w="full"
          h="full"
        />
      </Box>
    </Flex>
  );
};

export const getServerSideProps: GetServerSideProps<SharePreviewPageProps> = async (context) => {
  const shareId = typeof context.params?.shareId === "string" ? context.params.shareId : "";
  if (!shareId) {
    return { notFound: true };
  }

  const previewPath = sitePreviewPath(shareId, typeof context.params?.slug === "string" ? context.params.slug : undefined);
  const share = await getShareLink(shareId);
  if (!share || share.mode !== "preview") {
    return { notFound: true };
  }

  context.res.setHeader("Cache-Control", "private, no-store");
  const settings = await getSiteSettings(share.ownerUserId, share.projectToken);
  if (settings?.restricted) {
    const userId = getAuthUserFromRequest(context.req)?.sub;
    if (!userId) {
      return { redirect: { destination: "/login?lastRoute=" + encodeURIComponent(previewPath), permanent: false } };
    }
    if (!(await canViewRestrictedSite(share.ownerUserId, share.projectToken, userId))) {
      return { notFound: true };
    }
  }

  const project = await getProject(share.projectToken);
  if (!project) {
    return { notFound: true };
  }

  await ensureStaticSiteBuilt(shareId, project).catch(() => {
    console.warn("Static site pre-build failed for shareId:", shareId);
  });

  await recordSiteVisit(share, context.req.cookies.auth_token).catch(() => {
    console.warn("Could not record site preview visit");
  });

  return {
    props: {
      shareId,
      previewPath,
      siteName: settings?.name || project.name,
      updatedAt: project.updatedAt,
      driveEnabled: Boolean(
        await (await getMongoDb())
          .collection("site_plugins")
          .findOne({ owner: share.ownerUserId, projectToken: share.projectToken, id: "google-drive" }, { projection: { _id: 1 } }),
      ),
      signedIn: Boolean(getAuthUserFromRequest(context.req)?.sub),
      connectorStatus: typeof context.query.libraryConnectors === "string" ? context.query.libraryConnectors : null,
    },
  };
};

export default function PublishedSite(props: SharePreviewPageProps) {
  return <SharePreviewPage key={props.shareId} {...props} />;
}
