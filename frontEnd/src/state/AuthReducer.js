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
        default:
            return state;
    }
};

export default AuthReducer;