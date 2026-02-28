import { useState } from "react";
import {
  Avatar,
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
  Spinner,
  Text,
} from "@chakra-ui/react";
import { AddIcon, LogoIcon } from "./common/Icon";
import { AccountModal } from "./AccountModal";
import { ProjectCard } from "./ProjectCard";
import { useAuth } from "../contexts/AuthContext";
import { useProjects } from "../hooks/useProjects";
import VectorBackground from "./auth/VectorBackground";

export default function ProjectList() {
  const { user, loading: loadingUser } = useAuth();
  const {
    projects,
    loading,
    creating,
    createProject,
    openProject,
    renameProject,
    deleteProject,
    formatDate,
  } = useProjects();
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");

  const handleOpenCreateModal = () => setCreateModalOpen(true);
  const handleCloseCreateModal = () => {
    setCreateModalOpen(false);
    setNewProjectName("");
  };
  const handleCreateProject = async () => {
    const name = newProjectName.trim();
    if (!name) return;
    await createProject(name);
    handleCloseCreateModal();
  };

  const openAccountModal = () => {
    setAccountModalOpen(true);
  };

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
        <Flex
          direction={{ base: "column", lg: "row" }}
          flex="1"
          minH="0"
          align="stretch"
          gap={{ base: 6, lg: 0 }}
        >
          {/* 侧边栏 */}
          <Box
            w={{ base: "100%", lg: "300px" }}
            bg="rgba(255,255,255,0.75)"
            borderTopLeftRadius="2xl"
            borderTopRightRadius={{ base: "2xl", lg: 0 }}
            borderBottomRightRadius={{ base: 0, lg: 0 }}
            borderBottomLeftRadius={{ base: 0, lg: "2xl" }}
            border="1px solid rgba(255,255,255,0.7)"
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
                  <Badge
                    fontSize="0.6rem"
                    colorScheme="green"
                    variant="subtle"
                    borderRadius="full"
                    px={2}
                  >
                    LIVE
                  </Badge>
                </Flex>

                <Box>
                  <Text
                    fontSize="xs"
                    color="myGray.500"
                    mb={3}
                    textTransform="uppercase"
                    letterSpacing="wider"
                  >
                    工作台
                  </Text>
                  <Flex direction="column" gap={2}>
                    <Button
                      variant="ghost"
                      justifyContent="flex-start"
                      borderRadius="md"
                      bg="myGray.100"
                      _hover={{ bg: "myGray.150" }}
                      _active={{ bg: "myGray.200" }}
                    >
                      我的历史项目
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
                      新建项目
                    </Button>
                  </Flex>
                </Box>

                <Divider borderColor="myGray.150" />

                <Flex
                  mt="auto"
                  align="center"
                  gap={3}
                  p={2.5}
                  borderRadius="lg"
                  cursor="pointer"
                  bg="rgba(255,255,255,0.7)"
                  border="1px solid rgba(255,255,255,0.7)"
                  _hover={{ boxShadow: "0 8px 20px rgba(17, 24, 36, 0.08)" }}
                  onClick={openAccountModal}
                >
                  <Avatar size="sm" name={user?.username || "用户"} />
                  <Box flex="1" minW={0}>
                    <Text fontSize="sm" fontWeight="semibold" noOfLines={1}>
                      {loadingUser ? "加载中..." : user?.username || "未命名用户"}
                    </Text>
                    <Text fontSize="xs" color="myGray.500" noOfLines={1}>
                      {user?.contact || "普通账户"}
                    </Text>
                  </Box>
                </Flex>

                <AccountModal
                  isOpen={accountModalOpen}
                  onClose={() => setAccountModalOpen(false)}
                />

                <Modal isOpen={createModalOpen} onClose={handleCloseCreateModal} isCentered size="md">
                  <ModalOverlay bg="blackAlpha.400" />
                  <ModalContent
                    borderRadius="xl"
                    border="1px solid rgba(255,255,255,0.65)"
                    bg="rgba(255,255,255,0.92)"
                    backdropFilter="blur(18px)"
                  >
                    <ModalHeader color="myGray.800">新建项目</ModalHeader>
                    <ModalBody>
                      <FormControl isRequired>
                        <FormLabel color="myGray.700">项目名称</FormLabel>
                        <Input
                          placeholder="输入项目名称"
                          value={newProjectName}
                          onChange={(e) => setNewProjectName(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleCreateProject()}
                          autoFocus
                          bg="myWhite.100"
                        />
                      </FormControl>
                    </ModalBody>
                    <ModalFooter gap={2}>
                      <Button variant="ghost" onClick={handleCloseCreateModal}>
                        取消
                      </Button>
                      <Button
                        variant="whitePrimary"
                        onClick={handleCreateProject}
                        isLoading={creating}
                        isDisabled={!newProjectName.trim()}
                      >
                        创建
                      </Button>
                    </ModalFooter>
                  </ModalContent>
                </Modal>
            </Flex>
          </Box>

            {/* 主内容区 */}
          <Box
            flex={1}
            px={{ base: 5, md: 8, lg: 10 }}
            py={{ base: 6, md: 8 }}
            bg="rgba(255,255,255,0.65)"
            border="1px solid rgba(255,255,255,0.7)"
            borderLeft={{ base: "1px solid rgba(255,255,255,0.7)", lg: "none" }}
            borderTopLeftRadius={{ base: 0, lg: 0 }}
            borderTopRightRadius={{ base: 0, lg: "2xl" }}
            borderBottomRightRadius="2xl"
            borderBottomLeftRadius={{ base: "2xl", lg: 0 }}
            backdropFilter="blur(22px)"
          >
              <Flex
                align={{ base: "flex-start", md: "center" }}
                justify="space-between"
                direction={{ base: "column", md: "row" }}
                gap={4}
                mb={8}
              >
                <Box>
                  <Heading size="md" mb={2} color="myGray.800" lineHeight="1.2">
                    <Box
                      as="span"
                      bgClip="text"
                      bgGradient="linear(to-r, blue.600, green.500)"
                      color="transparent"
                    >
                      我的
                    </Box>{" "}
                    历史项目
                  </Heading>
                  <Text color="myGray.600">
                    继续编辑你的项目，或者快速创建一个新的想法。
                  </Text>
                </Box>
                <Button
                  variant="whitePrimary"
                  onClick={handleOpenCreateModal}
                  isLoading={creating}
                  loadingText="创建中..."
                  leftIcon={<Box as={AddIcon} w={4} h={4} />}
                  iconSpacing={2.5}
                  borderRadius="lg"
                >
                  新建项目
                </Button>
              </Flex>

              {loading ? (
                <Flex justify="center" align="center" minH="320px">
                  <Spinner size="xl" />
                </Flex>
              ) : projects.length === 0 ? (
                <Card
                  borderRadius="2xl"
                  border="1px solid rgba(255,255,255,0.7)"
                  bg="rgba(255,255,255,0.8)"
                  backdropFilter="blur(16px)"
                  boxShadow="0 18px 40px -24px rgba(15, 23, 42, 0.25)"
                >
                  <CardBody textAlign="center" py={12}>
                    <Text fontSize="lg" color="myGray.600" mb={4}>
                      还没有项目
                    </Text>
                    <Button
                      variant="whitePrimary"
                      onClick={handleOpenCreateModal}
                      isLoading={creating}
                      leftIcon={<Box as={AddIcon} w={4} h={4} />}
                      iconSpacing={2.5}
                    >
                      创建第一个项目
                    </Button>
                  </CardBody>
                </Card>
              ) : (
                <Grid
                  templateColumns={{
                    base: "1fr",
                    md: "repeat(2, 1fr)",
                    xl: "repeat(3, 1fr)",
                  }}
                  gap={5}
                >
                  {projects.map((project, index) => (
                    <ProjectCard
                      key={project.token}
                      index={index}
                      project={project}
                      formatDate={formatDate}
                      onOpen={openProject}
                      onRename={renameProject}
                      onDelete={deleteProject}
                    />
                  ))}
                </Grid>
              )}
          </Box>
        </Flex>
      </Flex>
    </Box>
  );
}
