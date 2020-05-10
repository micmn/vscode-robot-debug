*** Settings ***
Library    String
Library    Collections
Resource    ./Set_and_hit_two_breakpoints_in_different_files_aux.robot

*** Test Cases ***
A Simple Test Case
    Set Test Variable    ${var}    Value
    Test Keyword    ${var}    BBB

*** Keywords ***
Test Keyword
    [Arguments]    ${aaa}    ${bbb}
    @{list}=    Aux Keyword    ${aaa}    ${bbb}
