//ユーザー入力に応じた認証アクションを定義するファイル
export const loginStart = () => ({
    type: "LOGIN_START",
});

export const loginSuccess = (user) => ({
    type: "LOGIN_SUCCESS",
    payload: user,
});

export const loginError = (error) => ({
    type: "LOGIN_ERROR",
    payload: error,
});

export const UpdateSuccess = (user) => ({
    type: "UPDATE_SUCCESS",
    payload: user,
});