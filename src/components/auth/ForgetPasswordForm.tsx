import { Box, Button, Flex, Text } from "@chakra-ui/react";
import FormLayout from "./FormLayout";
import { LoginPageTypeEnum } from "./constants";

type ForgetPasswordFormProps = {
  setPageType: (pageType: LoginPageTypeEnum) => void;
};

const ForgetPasswordForm = ({ setPageType }: ForgetPasswordFormProps) => {
  return (
    <FormLayout setPageType={setPageType} pageType={LoginPageTypeEnum.forgot}>
      <Box mt={8}>
        <Text fontSize="sm" color="myGray.600" lineHeight="1.7">
          若你无法登录，请联系管理员或支持人员重置密码。我们会在核验账号后为你处理。
        </Text>
        <Flex mt={10} gap={3}>
          <Button w="100%" size="md" h={10} fontWeight="medium" variant="primary" onClick={() => setPageType(LoginPageTypeEnum.password)}>
            返回登录
          </Button>
        </Flex>
      </Box>
    </FormLayout>
  );
};

export default ForgetPasswordForm;
