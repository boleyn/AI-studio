import React from 'react';
import { Box, Button, Flex } from '@chakra-ui/react';
import MyIcon from '@/components/common/MyIcon';

export type WorkspacePayload = {
  type?: string;
  chatId?: string;
  userId?: string;
  tools?: string[];
  [key: string]: any;
};

type Props = {
  raw: string;
  payload?: WorkspacePayload | null;
  onOpenWorkspace?: (payload?: WorkspacePayload | null) => void;
  disabled?: boolean;
};

const WorkspaceCard = ({ payload, onOpenWorkspace, disabled }: Props) => {

  return (
    <Box mb={1.5} position={'relative'} maxW={'100%'} w={'100%'} minW={0}>
      <Box
        bg={'white'}
        borderRadius={'lg'}
        overflow={'hidden'}
        border={'1px solid'}
        borderColor={'myGray.200'}
        _hover={{
          borderColor: 'myGray.300'
        }}
        w={'100%'}
        maxW={'100%'}
        boxShadow={'sm'}
      >
        <Flex align="center" justify="space-between" px={4} py={3} minW={0}>
          <Flex align="center" gap={3} minW={0} flex={1}>
            <Box
              w={'2rem'}
              h={'2rem'}
              borderRadius={'md'}
              bg={'blue.50'}
              display={'flex'}
              alignItems={'center'}
              justifyContent={'center'}
              flexShrink={0}
            >
              <MyIcon name="common/folderFill" w="1.25rem" color={'blue.600'} />
            </Box>
            <Box
              fontWeight="500"
              fontSize="sm"
              color={'myGray.800'}
              minW={0}
              overflow={'hidden'}
              textOverflow={'ellipsis'}
              whiteSpace={'nowrap'}
            >
              {'工作区'}
            </Box>
          </Flex>
          <Button
            size="xs"
            py={1}
            px={2}
            variant="whitePrimary"
            onClick={() => onOpenWorkspace?.(payload)}
            isDisabled={disabled}
            borderColor={'green.300'}
            _hover={{
              bg: 'myGray.50',
              borderColor: 'green.300'
            }}
            flexShrink={0}
            ml={2}
          >
            {'打开工作区'}
          </Button>
        </Flex>
      </Box>
    </Box>
  );
};

export default WorkspaceCard;
