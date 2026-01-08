const AuthReducer = (state , actions) => {
    switch (actions.type) {
        case "LOGIN_START":
            return {
                user:null,
                isFetching:true,
                error:false,
            };
        case "LOGIN_SUCCESS":
            return {
                user:actions.payload,
                isFetching:false,
                error:false,
            };
        case "LOGIN_ERROR":
            return {
                user:null,
                isFetching:false,
                error:actions.payload,
            };
        case "LOGOUT":
            return {
                user: null,
                isFetching: false,
                error: false,
            };
        case "UPDATE_SUCCESS":
            return {
                ...state,
                user: actions.payload,
            };
        default:
            return state;
    }
};

export default AuthReducer;