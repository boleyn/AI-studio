export type UserSelectOptionItemType = { value: string };

export type InteractiveBasicType = {
  type: string;
  params: Record<string, any>;
};

export type UserSelectInteractive = {
  type: 'userSelect';
  params: {
    description?: string;
    userSelectOptions: UserSelectOptionItemType[];
    userSelectedVal?: string;
  };
};

export type UserInputInteractive = {
  type: 'userInput';
  params: {
    description?: string;
    submitted?: boolean;
    inputForm: Array<{
      key: string;
      label: string;
      type: string;
      required?: boolean;
      description?: string;
      value?: any;
      defaultValue?: any;
      minLength?: number;
    }>;
  };
};

export type PaymentPauseInteractive = {
  type: 'paymentPause';
  params: {
    continue?: boolean;
    description?: string;
  };
};
