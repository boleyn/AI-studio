import { useMemo, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Card,
  CardBody,
  Divider,
  Flex,
  FormControl,
  FormLabel,
  Grid,
  Heading,
  HStack,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
  Spinner,
  Tab,
  TabList,
  Tabs,
  Text,
  Tag,
} from "@chakra-ui/react";

import { AddIcon, LogoIcon, SearchIcon } from "./common/Icon";
import DashboardEntityCard from "./cards/DashboardEntityCard";
import { UserAccountMenu } from "./UserAccountMenu";
import VectorBackground from "./auth/VectorBackground";
import { useAuth } from "../contexts/AuthContext";
import { useProjects } from "../hooks/useProjects";
import { useSkills } from "../hooks/useSkills";

type HomeTab = "projects" | "skills";
type CreateType = "project" | "skill";

export default function ProjectList() {
  const { user, loading: loadingUser } = useAuth();
  const {
    projects,
    loading: loadingProjects,
    creating: creatingProject,
    createProject,
    openProject,
    renameProject,
    deleteProject,
    duplicateProject,
    formatDate,
  } = useProjects();
  const {
    skills,
    loading: loadingSkills,
    creating: creatingSkill,
    createSkill,
    openSkill,
    deleteSkill,
    duplicateSkill,
  } = useSkills();

  const [activeTab, setActiveTab] = useState<HomeTab>("projects");
  const [searchValue, setSearchValue] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createType, setCreateType] = useState<CreateType>("project");
  const [nameInput, setNameInput] = useState("");
  const [descriptionInput, setDescriptionInput] = useState("");

  const keyword = searchValue.trim().toLowerCase();
  const filteredProjects = useMemo(() => {
    if (!keyword) return projects;
    return projects.filter((item) => item.name.toLowerCase().includes(keyword));
  }, [keyword, projects]);
  const filteredSkills = useMemo(() => {
    if (!keyword) return skills;
    return skills.filter((item) => {
      return (
        item.name.toLowerCase().includes(keyword) ||
        item.description.toLowerCase().includes(keyword)
      );
    });
  }, [keyword, skills]);

  const creating = creatingProject || creatingSkill;

  const resetCreateModal = () => {
    setNameInput("");
    setDescriptionInput("");
    setCreateType(activeTab === "skills" ? "skill" : "project");
  };

  const handleOpenCreateModal = () => {
    resetCreateModal();
    setCreateModalOpen(true);
  };
  const handleCloseCreateModal = () => {
    setCreateModalOpen(false);
    resetCreateModal();
  };

  const handleCreate = async () => {
    const name = nameInput.trim();
    if (!name) return;

    if (createType === "project") {
      await createProject(name);
      handleCloseCreateModal();
      return;
    }

    if (createType === "skill") {
      const created = await createSkill({
        sourceType: "custom",
        name,
        description: descriptionInput.trim() || undefined,
      });
      if (created) {
        handleCloseCreateModal();
      }
    } else {
      return;
    }
  };

  const currentLoading = activeTab === "projects" ? loadingProjects : loadingSkills;
  const isProjectsTab = activeTab === "projects";
  const navActiveStyles = {
    bg: "myGray.100",
    border: "1px solid rgba(148,163,184,0.55)",
    color: "myGray.800",
    fontWeight: "semibold",
  } as const;
  const navInactiveStyles = {
    bg: "transparent",
    border: "1px solid transparent",
    color: "myGray.700",
    fontWeight: "medium",
  } as const;

  return (
    <Box position="relative" minH="100vh" overflow="hidden">
      <VectorBackground />
      <Flex
        direction="column"
        minH="100vh"
        align="stretch"
        justify="flex-start"
        px={{ base: 4, md: 8, xl: 10 }}
        py={{ base: 6, md: 8 }}
        position="relative"
        zIndex={1}
      >
        <Flex direction={{ base: "column", lg: "row" }} flex="1" minH="0" align="stretch" gap={{ base: 6, lg: 0 }}>
          <Box
            w={{ base: "100%", lg: "300px" }}
            bg="var(--ws-surface)"
            borderTopLeftRadius="2xl"
            borderTopRightRadius={{ base: "2xl", lg: 0 }}
            borderBottomRightRadius={{ base: 0, lg: 0 }}
            borderBottomLeftRadius={{ base: 0, lg: "2xl" }}
            border="1px solid var(--ws-border)"
            px={{ base: 5, md: 6 }}
            py={{ base: 6, md: 7 }}
            backdropFilter="blur(18px)"
            minH={{ base: "auto", lg: "100%" }}
            display="flex"
          >
            <Flex direction="column" h="100%" gap={6} flex="1">
              <Flex align="center" justify="space-between">
                <HStack spacing={3}>
                  <Box as={LogoIcon} w={7} h={7} flexShrink={0} />
                  <Box>
                    <Heading size="sm" color="myGray.800">
                      AI Studio
                    </Heading>
                    <Text fontSize="xs" color="myGray.500">
                      MODEL LAB
                    </Text>
                  </Box>
                </HStack>
                <Badge fontSize="0.6rem" colorScheme="green" variant="subtle" borderRadius="full" px={2}>
                  LIVE
                </Badge>
              </Flex>

              <Box>
                <Text fontSize="xs" color="myGray.500" mb={3} textTransform="uppercase" letterSpacing="wider">
                  工作台
                </Text>
                <Flex direction="column" gap={2}>
                  <Button
                    variant="ghost"
                    justifyContent="flex-start"
                    borderRadius="md"
                    {...(isProjectsTab ? navActiveStyles : navInactiveStyles)}
                    _hover={{ bg: "myGray.150", borderColor: "rgba(148,163,184,0.5)" }}
                    onClick={() => setActiveTab("projects")}
                  >
                    我的历史项目
                  </Button>
                  <Button
                    variant="ghost"
                    justifyContent="flex-start"
                    borderRadius="md"
                    {...(!isProjectsTab ? navActiveStyles : navInactiveStyles)}
                    _hover={{ bg: "myGray.150", borderColor: "rgba(148,163,184,0.5)" }}
                    onClick={() => setActiveTab("skills")}
                  >
                    全局 Skills
                  </Button>
                  <Button
                    variant="ghost"
                    justifyContent="flex-start"
                    borderRadius="md"
                    onClick={handleOpenCreateModal}
                    isLoading={creating}
                    leftIcon={<Box as={AddIcon} w={4} h={4} />}
                    iconSpacing={2.5}
                    fontWeight="medium"
                    color="primary.700"
                    _hover={{ bg: "myGray.100" }}
                  >
                    新增
                  </Button>
                </Flex>
              </Box>

              <Divider borderColor="var(--ws-border)" />

              <UserAccountMenu user={user} loadingUser={loadingUser} />
            </Flex>
          </Box>

          <Box
            flex={1}
            px={{ base: 5, md: 8, lg: 10 }}
            py={{ base: 6, md: 8 }}
            bg="var(--ws-surface)"
            border="1px solid var(--ws-border)"
            borderLeft={{ base: "1px solid var(--ws-border)", lg: "none" }}
            borderTopLeftRadius={{ base: 0, lg: 0 }}
            borderTopRightRadius={{ base: 0, lg: "2xl" }}
            borderBottomRightRadius="2xl"
            borderBottomLeftRadius={{ base: "2xl", lg: 0 }}
            backdropFilter="blur(22px)"
          >
            <Flex
              align={{ base: "flex-start", lg: "center" }}
              justify="space-between"
              direction={{ base: "column", lg: "row" }}
              gap={4}
              mb={6}
            >
              <Box>
                <Heading size="md" mb={2} color="myGray.800" lineHeight="1.2">
                  工作台首页
                </Heading>
                <Text color="myGray.600">
                  统一管理项目与技能，快速切换并继续你的工作流。
                </Text>
              </Box>
              <HStack spacing={3} w={{ base: "100%", lg: "auto" }}>
                <Box position="relative" w={{ base: "100%", lg: "320px" }}>
                  <Box as={SearchIcon} w={4} h={4} position="absolute" left={3} top="50%" transform="translateY(-50%)" color="myGray.500" />
                  <Input
                    pl={9}
                    placeholder={isProjectsTab ? "搜索项目名称" : "搜索 skill 名称或描述"}
                    value={searchValue}
                    onChange={(event) => setSearchValue(event.target.value)}
                    bg="myWhite.100"
                  />
                </Box>
                <Button
                  variant="whitePrimary"
                  onClick={handleOpenCreateModal}
                  isLoading={creating}
                  leftIcon={<Box as={AddIcon} w={4} h={4} />}
                >
                  新增
                </Button>
              </HStack>
            </Flex>

            <Tabs index={isProjectsTab ? 0 : 1} onChange={(index) => setActiveTab(index === 0 ? "projects" : "skills")} mb={6}>
              <TabList>
                <Tab>项目 ({projects.length})</Tab>
                <Tab>Skills ({skills.length})</Tab>
              </TabList>
            </Tabs>

            {currentLoading ? (
              <Flex justify="center" align="center" minH="320px">
                <Spinner size="xl" />
              </Flex>
            ) : isProjectsTab ? (
              filteredProjects.length === 0 ? (
                <Card
                  borderRadius="2xl"
                  border="1px solid rgba(255,255,255,0.7)"
                  bg="rgba(255,255,255,0.8)"
                  backdropFilter="blur(16px)"
                  boxShadow="0 2px 8px -6px rgba(15, 23, 42, 0.15)"
                >
                  <CardBody textAlign="center" py={12}>
                    <Text fontSize="lg" color="myGray.600" mb={4}>
                      没有匹配的项目
                    </Text>
                    <Button variant="whitePrimary" onClick={handleOpenCreateModal} isLoading={creating} leftIcon={<Box as={AddIcon} w={4} h={4} />}>
                      新建项目
                    </Button>
                  </CardBody>
                </Card>
              ) : (
                <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", xl: "repeat(3, 1fr)" }} gap={5}>
                  {filteredProjects.map((project, index) => (
                    <DashboardEntityCard
                      key={project.token}
                      index={index}
                      title={project.name}
                      topBadges={
                        <>
                          <Tag size="sm" borderRadius="full" colorScheme="teal" variant="subtle">
                            PROJECT
                          </Tag>
                          <Badge colorScheme="teal" variant="solid">
                            历史项目
                          </Badge>
                        </>
                      }
                      description={`项目描述：${project.name}`}
                      meta={`最近更新：${formatDate(project.updatedAt)}`}
                      onOpen={() => openProject(project.token)}
                      onRename={(nextName) => renameProject(project.token, nextName)}
                      renameDialogTitle="修改项目名称"
                      renameFieldLabel="项目名称"
                      renamePlaceholder="输入项目名称"
                      onDelete={() => deleteProject(project.token)}
                      onDuplicate={() => duplicateProject(project.token)}
                      deleteDialogTitle="删除项目"
                      deleteDialogBody={`确定删除项目「${project.name}」吗？将同时删除该项目的所有对话记录和文件，此操作无法撤销。`}
                    />
                  ))}
                </Grid>
              )
            ) : filteredSkills.length === 0 ? (
              <Card
                borderRadius="2xl"
                border="1px solid rgba(167,243,208,0.75)"
                bg="rgba(240,253,250,0.85)"
                backdropFilter="blur(16px)"
                boxShadow="0 2px 8px -6px rgba(13, 148, 136, 0.15)"
              >
                <CardBody textAlign="center" py={12}>
                  <Text fontSize="lg" color="teal.700" mb={4}>
                    没有匹配的 Skill
                  </Text>
                  <Button variant="whitePrimary" onClick={handleOpenCreateModal} isLoading={creating} leftIcon={<Box as={AddIcon} w={4} h={4} />}>
                    新建 Skill
                  </Button>
                </CardBody>
              </Card>
            ) : (
              <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", xl: "repeat(3, 1fr)" }} gap={5}>
                {filteredSkills.map((skill, index) => (
                  <DashboardEntityCard
                    key={skill.token}
                    index={index}
                    title={skill.name}
                    topBadges={
                      <>
                        <Tag size="sm" borderRadius="full" colorScheme="teal" variant="subtle">
                          SKILL
                        </Tag>
                        <Badge colorScheme={skill.sourceType === "template" ? "cyan" : "teal"} variant="solid">
                          {skill.sourceType === "template" ? "模板" : "自定义"}
                        </Badge>
                      </>
                    }
                    description={`触发描述：${skill.description || "无描述"}`}
                    meta={`最近更新：${formatDate(skill.updatedAt)}`}
                    onOpen={() => {
                      void openSkill(skill.token);
                    }}
                    onDuplicate={async () => {
                      await duplicateSkill(skill.token);
                    }}
                    onDelete={async () => {
                      await deleteSkill(skill.token);
                    }}
                    deleteDialogTitle="删除 Skill"
                    deleteDialogBody={`确定删除 Skill「${skill.name}」吗？该操作不可撤销。`}
                  />
                ))}
              </Grid>
            )}
          </Box>
        </Flex>
      </Flex>

      <Modal isOpen={createModalOpen} onClose={handleCloseCreateModal} isCentered size="md">
        <ModalOverlay bg="blackAlpha.400" />
        <ModalContent borderRadius="xl" border="1px solid rgba(255,255,255,0.65)" bg="rgba(255,255,255,0.92)" backdropFilter="blur(18px)">
          <ModalHeader color="myGray.800">新增</ModalHeader>
          <ModalBody>
            <FormControl isRequired mb={4}>
              <FormLabel color="myGray.700">类型</FormLabel>
              <Select value={createType} onChange={(event) => setCreateType(event.target.value as CreateType)}>
                <option value="project">项目</option>
                <option value="skill">Skill</option>
              </Select>
            </FormControl>

            <FormControl isRequired mb={createType === "project" ? 0 : 4}>
              <FormLabel color="myGray.700">{createType === "project" ? "项目名称" : "Skill 名称"}</FormLabel>
              <Input
                placeholder={createType === "project" ? "输入项目名称" : "输入 skill 名称"}
                value={nameInput}
                onChange={(event) => setNameInput(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && void handleCreate()}
                autoFocus
                bg="myWhite.100"
              />
            </FormControl>

            {createType === "skill" ? (
              <FormControl mb={0}>
                <FormLabel color="myGray.700">触发描述</FormLabel>
                <Input
                  placeholder="描述这个 skill 适合在什么场景触发"
                  value={descriptionInput}
                  onChange={(event) => setDescriptionInput(event.target.value)}
                  bg="myWhite.100"
                />
              </FormControl>
            ) : null}
          </ModalBody>
          <ModalFooter gap={2}>
            <Button variant="ghost" onClick={handleCloseCreateModal}>
              取消
            </Button>
            <Button
              variant="whitePrimary"
              onClick={() => {
                void handleCreate();
              }}
              isLoading={creating}
              isDisabled={!nameInput.trim()}
            >
              创建
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
}
